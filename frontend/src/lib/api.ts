import { getToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type User = {
  id: string;
  name: string;
  email: string;
  created_at: string;
};

export type AuthResponse = {
  user: User;
  token: string;
};

export type AccessRole = "owner" | "editor" | "viewer";
export type CollaboratorRole = "editor" | "viewer";

export type TextDocument = {
  id: string;
  owner_id: string;
  title: string;
  content?: string;
  version: number;
  access_role: AccessRole;
  created_at: string;
  updated_at: string;
};

export type Collaborator = {
  id: string;
  name: string;
  email: string;
  role: AccessRole;
  added_at: string;
};

type ApiErrorBody = {
  message?: string;
};

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
) {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured");
  }

  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = data as ApiErrorBody | null;

    throw new Error(
      errorBody?.message || "Request failed"
    );
  }

  return data as T;
}

export function registerUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function loginUser(input: {
  email: string;
  password: string;
}) {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listDocuments() {
  return apiRequest<{ documents: TextDocument[] }>(
    "/documents"
  );
}

export function createDocument(input: {
  title: string;
  content?: string;
}) {
  return apiRequest<{ document: TextDocument }>(
    "/documents",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export function getDocument(documentId: string) {
  return apiRequest<{ document: TextDocument }>(
    `/documents/${documentId}`
  );
}

export function updateDocument(
  documentId: string,
  input: {
    title: string;
  }
) {
  return apiRequest<{ document: TextDocument }>(
    `/documents/${documentId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export function listCollaborators(documentId: string) {
  return apiRequest<{ collaborators: Collaborator[] }>(
    `/documents/${documentId}/collaborators`
  );
}

export function addCollaborator(
  documentId: string,
  input: {
    email: string;
    role: CollaboratorRole;
  }
) {
  return apiRequest<{ collaborator: Collaborator }>(
    `/documents/${documentId}/collaborators`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export function updateCollaboratorRole(
  documentId: string,
  userId: string,
  role: CollaboratorRole
) {
  return apiRequest<{ collaborator: Collaborator }>(
    `/documents/${documentId}/collaborators/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }
  );
}

export function removeCollaborator(
  documentId: string,
  userId: string
) {
  return apiRequest<{ message: string }>(
    `/documents/${documentId}/collaborators/${userId}`,
    {
      method: "DELETE",
    }
  );
}