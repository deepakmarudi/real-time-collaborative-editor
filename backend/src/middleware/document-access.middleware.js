import { getDocumentForUser } from "../services/document-access.service.js";

export function requireDocumentAccess(requiredRole) {
  return async function documentAccessMiddleware(req, res, next) {
    try {
      const { documentId } = req.params;

      const access = await getDocumentForUser(
        req.user.id,
        documentId,
        requiredRole
      );

      if (!access.ok) {
        return res.status(access.status).json({
          message: access.message,
        });
      }

      req.document = access.document;
      next();
    } catch (error) {
      console.error("Document access check failed:", error);

      res.status(500).json({
        message: "Document access check failed",
      });
    }
  };
}