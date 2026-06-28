"use client";

import { useState, type FormEvent } from "react";
import {
  addCollaborator,
  listCollaborators,
  removeCollaborator,
  updateCollaboratorRole,
  type Collaborator,
  type CollaboratorRole,
} from "@/lib/api";

type CollaboratorPanelProps = {
  documentId: string;
};

function sortCollaborators(collaborators: Collaborator[]) {
  return [...collaborators].sort((first, second) => {
    if (first.role === "owner") return -1;
    if (second.role === "owner") return 1;

    return first.name.localeCompare(second.name);
  });
}

export function CollaboratorPanel({
  documentId,
}: CollaboratorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [collaborators, setCollaborators] = useState<
    Collaborator[]
  >([]);
  const [email, setEmail] = useState("");
  const [role, setRole] =
    useState<CollaboratorRole>("editor");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");

  async function handleToggle() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setIsOpen(true);
    setIsWorking(true);
    setError("");

    try {
      const result = await listCollaborators(documentId);

      setCollaborators(
        sortCollaborators(result.collaborators)
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load collaborators"
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleAddCollaborator(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!email.trim()) return;

    setIsWorking(true);
    setError("");

    try {
      const result = await addCollaborator(documentId, {
        email: email.trim(),
        role,
      });

      setCollaborators((currentCollaborators) =>
        sortCollaborators([
          ...currentCollaborators.filter(
            (collaborator) =>
              collaborator.id !== result.collaborator.id
          ),
          result.collaborator,
        ])
      );

      setEmail("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to add collaborator"
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleRoleChange(
    userId: string,
    nextRole: CollaboratorRole
  ) {
    setIsWorking(true);
    setError("");

    try {
      const result = await updateCollaboratorRole(
        documentId,
        userId,
        nextRole
      );

      setCollaborators((currentCollaborators) =>
        currentCollaborators.map((collaborator) =>
          collaborator.id === userId
            ? result.collaborator
            : collaborator
        )
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to update collaborator"
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleRemove(userId: string) {
    const confirmed = window.confirm(
      "Remove this collaborator from the document?"
    );

    if (!confirmed) return;

    setIsWorking(true);
    setError("");

    try {
      await removeCollaborator(documentId, userId);

      setCollaborators((currentCollaborators) =>
        currentCollaborators.filter(
          (collaborator) => collaborator.id !== userId
        )
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to remove collaborator"
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className="mt-6 border-y border-slate-800 py-4">
      <button
        type="button"
        onClick={handleToggle}
        className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:border-slate-500"
      >
        {isOpen ? "Close access" : "Manage access"}
      </button>

      {isOpen && (
        <div className="mt-4">
          <form
            onSubmit={handleAddCollaborator}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="min-w-64 flex-1 text-sm text-slate-400">
              Collaborator email
              <input
                type="email"
                value={email}
                disabled={isWorking}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                placeholder="student@example.com"
              />
            </label>

            <label className="text-sm text-slate-400">
              Role
              <select
                value={role}
                disabled={isWorking}
                onChange={(event) =>
                  setRole(
                    event.target.value as CollaboratorRole
                  )
                }
                className="mt-1 block rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={isWorking || !email.trim()}
              className="rounded-md bg-white px-4 py-2 font-medium text-slate-950 disabled:opacity-50"
            >
              Add
            </button>
          </form>

          {error && (
            <p className="mt-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="mt-5 divide-y divide-slate-800">
            {collaborators.map((collaborator) => (
              <div
                key={collaborator.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-medium">
                    {collaborator.name}
                  </p>
                  <p className="text-sm text-slate-400">
                    {collaborator.email}
                  </p>
                </div>

                {collaborator.role === "owner" ? (
                  <span className="text-sm text-slate-400">
                    Owner
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={collaborator.role}
                      disabled={isWorking}
                      onChange={(event) =>
                        handleRoleChange(
                          collaborator.id,
                          event.target
                            .value as CollaboratorRole
                        )
                      }
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>

                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() =>
                        handleRemove(collaborator.id)
                      }
                      className="rounded-md border border-red-900 px-3 py-1 text-sm text-red-300 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}

            {!isWorking && collaborators.length === 0 && (
              <p className="py-3 text-sm text-slate-400">
                No collaborators found.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}