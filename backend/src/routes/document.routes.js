import express from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireDocumentAccess } from "../middleware/document-access.middleware.js";

export const documentRouter = express.Router();

const COLLABORATOR_ROLES = new Set(["viewer", "editor"]);

function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function notifyAccessChanged(
  req,
  documentId,
  userId,
  role
) {
  const io = req.app.get("io");

  if (!io) return;

  io.to(`user:${userId}`).emit(
    "document:access-updated",
    {
      documentId,
      role,
    }
  );
}

function notifyAccessRevoked(req, documentId, userId) {
  const io = req.app.get("io");

  if (!io) return;

  const userRoom = `user:${userId}`;
  const documentRoom = `document:${documentId}`;

  io.to(userRoom).emit("document:access-revoked", {
    documentId,
  });

  io.in(userRoom).socketsLeave(documentRoom);
}

documentRouter.use(requireAuth);

documentRouter.post("/", async (req, res) => {
  try {
    const { title, content = "" } = req.body;

    if (
      typeof title !== "string" ||
      title.trim().length === 0
    ) {
      return res.status(400).json({
        message: "Document title is required",
      });
    }

    if (typeof content !== "string") {
      return res.status(400).json({
        message: "Document content must be a string",
      });
    }

    const result = await query(
      `
      INSERT INTO documents (owner_id, title, content)
      VALUES ($1, $2, $3)
      RETURNING
        id,
        owner_id,
        title,
        content,
        version,
        created_at,
        updated_at
      `,
      [req.user.id, title.trim(), content]
    );

    res.status(201).json({
      document: {
        ...result.rows[0],
        access_role: "owner",
      },
    });
  } catch (error) {
    console.error("Create document failed:", error);

    res.status(500).json({
      message: "Create document failed",
    });
  }
});

documentRouter.get("/", async (req, res) => {
  try {
    const result = await query(
      `
      SELECT
        d.id,
        d.owner_id,
        d.title,
        d.version,
        d.created_at,
        d.updated_at,
        CASE
          WHEN d.owner_id = $1 THEN 'owner'
          ELSE dc.role
        END AS access_role
      FROM documents d
      LEFT JOIN document_collaborators dc
        ON dc.document_id = d.id
        AND dc.user_id = $1
      WHERE d.owner_id = $1 OR dc.user_id = $1
      ORDER BY d.updated_at DESC
      `,
      [req.user.id]
    );

    res.json({
      documents: result.rows,
    });
  } catch (error) {
    console.error("List documents failed:", error);

    res.status(500).json({
      message: "List documents failed",
    });
  }
});

documentRouter.get(
  "/:documentId/collaborators",
  requireDocumentAccess("owner"),
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT
          u.id,
          u.name,
          u.email,
          'owner' AS role,
          d.created_at AS added_at
        FROM documents d
        JOIN users u ON u.id = d.owner_id
        WHERE d.id = $1

        UNION ALL

        SELECT
          u.id,
          u.name,
          u.email,
          dc.role,
          dc.created_at AS added_at
        FROM document_collaborators dc
        JOIN users u ON u.id = dc.user_id
        WHERE dc.document_id = $1

        ORDER BY role, added_at
        `,
        [req.document.id]
      );

      res.json({
        collaborators: result.rows,
      });
    } catch (error) {
      console.error("List collaborators failed:", error);

      res.status(500).json({
        message: "List collaborators failed",
      });
    }
  }
);

documentRouter.post(
  "/:documentId/collaborators",
  requireDocumentAccess("owner"),
  async (req, res) => {
    try {
      const { email, role } = req.body;

      if (
        typeof email !== "string" ||
        email.trim().length === 0
      ) {
        return res.status(400).json({
          message: "Collaborator email is required",
        });
      }

      if (!COLLABORATOR_ROLES.has(role)) {
        return res.status(400).json({
          message: "Role must be viewer or editor",
        });
      }

      const userResult = await query(
        `
        SELECT id, name, email
        FROM users
        WHERE LOWER(email) = LOWER($1)
        `,
        [email.trim()]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          message: "No registered user has that email",
        });
      }

      const collaborator = userResult.rows[0];

      if (collaborator.id === req.document.owner_id) {
        return res.status(400).json({
          message: "The document owner is already a member",
        });
      }

      const result = await query(
        `
        INSERT INTO document_collaborators (
          document_id,
          user_id,
          role
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (document_id, user_id)
        DO UPDATE SET role = EXCLUDED.role
        RETURNING role, created_at
        `,
        [
          req.document.id,
          collaborator.id,
          role,
        ]
      );

      const addedCollaborator = {
        ...collaborator,
        role: result.rows[0].role,
        added_at: result.rows[0].created_at,
      };

      notifyAccessChanged(
        req,
        req.document.id,
        collaborator.id,
        addedCollaborator.role
      );

      res.json({
        collaborator: addedCollaborator,
      });
    } catch (error) {
      console.error("Add collaborator failed:", error);

      res.status(500).json({
        message: "Add collaborator failed",
      });
    }
  }
);

documentRouter.patch(
  "/:documentId/collaborators/:userId",
  requireDocumentAccess("owner"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (!isValidUuid(userId)) {
        return res.status(400).json({
          message: "Invalid collaborator ID",
        });
      }

      if (!COLLABORATOR_ROLES.has(role)) {
        return res.status(400).json({
          message: "Role must be viewer or editor",
        });
      }

      const result = await query(
        `
        UPDATE document_collaborators dc
        SET role = $1
        FROM users u
        WHERE dc.document_id = $2
          AND dc.user_id = $3
          AND u.id = dc.user_id
        RETURNING
          u.id,
          u.name,
          u.email,
          dc.role,
          dc.created_at AS added_at
        `,
        [role, req.document.id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Collaborator not found",
        });
      }

      notifyAccessChanged(
        req,
        req.document.id,
        userId,
        result.rows[0].role
      );

      res.json({
        collaborator: result.rows[0],
      });
    } catch (error) {
      console.error("Update collaborator failed:", error);

      res.status(500).json({
        message: "Update collaborator failed",
      });
    }
  }
);

documentRouter.delete(
  "/:documentId/collaborators/:userId",
  requireDocumentAccess("owner"),
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidUuid(userId)) {
        return res.status(400).json({
          message: "Invalid collaborator ID",
        });
      }

      const result = await query(
        `
        DELETE FROM document_collaborators
        WHERE document_id = $1
          AND user_id = $2
        RETURNING user_id
        `,
        [req.document.id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Collaborator not found",
        });
      }

      notifyAccessRevoked(
        req,
        req.document.id,
        userId
      );

      res.json({
        message: "Collaborator removed",
      });
    } catch (error) {
      console.error("Remove collaborator failed:", error);

      res.status(500).json({
        message: "Remove collaborator failed",
      });
    }
  }
);

documentRouter.get(
  "/:documentId",
  requireDocumentAccess("viewer"),
  (req, res) => {
    res.json({
      document: req.document,
    });
  }
);

documentRouter.patch(
  "/:documentId",
  requireDocumentAccess("editor"),
  async (req, res) => {
    try {
      const { title } = req.body;

      if (
        typeof title !== "string" ||
        title.trim().length === 0
      ) {
        return res.status(400).json({
          message: "Document title cannot be empty",
        });
      }

      const result = await query(
        `
        UPDATE documents
        SET title = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          owner_id,
          title,
          content,
          version,
          created_at,
          updated_at
        `,
        [title.trim(), req.document.id]
      );

      res.json({
        document: {
          ...result.rows[0],
          access_role: req.document.access_role,
        },
      });
    } catch (error) {
      console.error("Update document failed:", error);

      res.status(500).json({
        message: "Update document failed",
      });
    }
  }
);

documentRouter.delete(
  "/:documentId",
  requireDocumentAccess("owner"),
  async (req, res) => {
    try {
      await query(
        `
        DELETE FROM documents
        WHERE id = $1
        `,
        [req.document.id]
      );

      const io = req.app.get("io");
      const room = `document:${req.document.id}`;

      io?.to(room).emit("document:deleted", {
        documentId: req.document.id,
      });

      io?.in(room).socketsLeave(room);

      res.json({
        message: "Document deleted",
      });
    } catch (error) {
      console.error("Delete document failed:", error);

      res.status(500).json({
        message: "Delete document failed",
      });
    }
  }
);