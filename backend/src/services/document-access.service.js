import { query } from "../db/pool.js";

const roleRank = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function hasRequiredRole(actualRole, requiredRole) {
  return roleRank[actualRole] >= roleRank[requiredRole];
}

export async function getDocumentForUser(userId, documentId, requiredRole) {
  const result = await query(
    `
    SELECT
      d.id,
      d.owner_id,
      d.title,
      d.content,
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
    WHERE d.id = $2
      AND (d.owner_id = $1 OR dc.user_id = $1)
    `,
    [userId, documentId]
  );

  if (result.rows.length === 0) {
    return {
      ok: false,
      status: 404,
      message: "Document not found",
    };
  }

  const document = result.rows[0];

  if (!hasRequiredRole(document.access_role, requiredRole)) {
    return {
      ok: false,
      status: 403,
      message: "You do not have permission for this document",
    };
  }

  return {
    ok: true,
    document,
  };
}