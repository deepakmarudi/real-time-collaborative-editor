"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDocument,
  listDocuments,
  TextDocument,
} from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";

export default function DashboardPage() {
  const router = useRouter();

  const [documents, setDocuments] = useState<TextDocument[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    listDocuments()
      .then((result) => {
        setDocuments(result.documents);
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load documents"
        );
      });
  }, [router]);

  async function handleCreateDocument() {
    if (!title.trim()) return;

    setError("");

    try {
      const result = await createDocument({
        title,
        content: "",
      });

      setDocuments((currentDocuments) => [
        result.document,
        ...currentDocuments,
      ]);

      setTitle("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create document"
      );
    }
  }

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <section className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">
              Collaborative Editor
            </p>
            <h1 className="text-3xl font-bold">Documents</h1>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm"
          >
            Logout
          </button>
        </header>

        <div className="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <label className="text-sm text-slate-400">
            New document
          </label>

          <div className="mt-3 flex gap-3">
            <input
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              placeholder="Document title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />

            <button
              onClick={handleCreateDocument}
              className="rounded-md bg-white px-4 py-2 font-medium text-slate-950"
            >
              Create
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          )}
        </div>

        <div className="mt-6 space-y-3">
          {documents.map((document) => (
            <Link
              key={document.id}
              href={`/documents/${document.id}`}
              className="block rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"
            >
              <h2 className="font-semibold">{document.title}</h2>

              <p className="mt-1 text-sm text-slate-400">
                Role: {document.access_role} | Version:{" "}
                {document.version}
              </p>
            </Link>
          ))}

          {documents.length === 0 && (
            <p className="text-slate-400">No documents yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}