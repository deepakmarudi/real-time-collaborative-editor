"use client";

import { io, type Socket } from "socket.io-client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ActiveUsers,
  type ActiveUser,
} from "@/components/active-users";
import { CollaboratorPanel } from "@/components/collaborator-panel";
import {
  updateDocument,
  type CollaboratorRole,
  type TextDocument,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import {
  TextOperation,
  type SerializedTextOperation,
} from "@/lib/text-operation";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type PendingOperation = {
  operationId: string;
  operation: TextOperation;
  sent: boolean;
  baseVersion?: number;
};

type ServerOperation = {
  operationId: string;
  baseVersion: number;
  version: number;
  operation: SerializedTextOperation;
};

type JoinResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  document?: TextDocument;
  activeUsers?: ActiveUser[];
  recovery?: {
    historyAvailable: boolean;
    missedOperations: ServerOperation[];
  };
};

type OperationResponse = {
  ok: boolean;
  message?: string;
  version?: number;
  currentVersion?: number;
  document?: {
    content: string;
    version: number;
  };
};

type OperationAppliedEvent = ServerOperation & {
  documentId: string;
  updatedBy: {
    id: string;
    name: string;
  };
};

type AccessUpdatedEvent = {
  documentId: string;
  role: CollaboratorRole;
};

type DocumentEvent = {
  documentId: string;
};

type PresenceEvent = {
  user: ActiveUser;
};

function sortActiveUsers(users: ActiveUser[]) {
  return [...users].sort((first, second) =>
    first.name.localeCompare(second.name)
  );
}

export default function DocumentEditorPage() {
  const router = useRouter();
  const params = useParams<{ documentId: string }>();

  const [document, setDocument] =
    useState<TextDocument | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [activeUsers, setActiveUsers] = useState<
    ActiveUser[]
  >([]);
  const [error, setError] = useState(
    API_URL ? "" : "NEXT_PUBLIC_API_URL is not configured"
  );
  const [saveStatus, setSaveStatus] = useState("Connecting...");
  const [connectionStatus, setConnectionStatus] =
    useState("Disconnected");
  const [isJoined, setIsJoined] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const contentRef = useRef("");
  const versionRef = useRef(0);
  const joinedRef = useRef(false);
  const hasLoadedDocumentRef = useRef(false);
  const pendingOperationsRef = useRef<PendingOperation[]>([]);

  const applyServerSnapshot = useCallback(
    (snapshot: { content: string; version: number }) => {
      pendingOperationsRef.current = [];
      contentRef.current = snapshot.content;
      versionRef.current = snapshot.version;

      setContent(snapshot.content);

      setDocument((currentDocument) => {
        if (!currentDocument) return currentDocument;

        return {
          ...currentDocument,
          content: snapshot.content,
          version: snapshot.version,
        };
      });
    },
    []
  );

  const sendNextOperation = useCallback(
    function sendNextOperation() {
      const socket = socketRef.current;
      const nextOperation = pendingOperationsRef.current[0];

      if (
        !socket ||
        !socket.connected ||
        !joinedRef.current ||
        !nextOperation ||
        nextOperation.sent
      ) {
        return;
      }

      nextOperation.sent = true;
      nextOperation.baseVersion = versionRef.current;

      socket.emit(
        "document:operation",
        {
          documentId: params.documentId,
          operationId: nextOperation.operationId,
          baseVersion: nextOperation.baseVersion,
          operation: nextOperation.operation.toJSON(),
        },
        (response: OperationResponse) => {
          const firstPending =
            pendingOperationsRef.current[0];

          if (
            !firstPending ||
            firstPending.operationId !==
              nextOperation.operationId
          ) {
            return;
          }

          if (!response.ok) {
            if (response.document) {
              applyServerSnapshot(response.document);
              setSaveStatus("Resynchronized");
              setError(response.message || "");
              return;
            }

            firstPending.sent = false;
            setSaveStatus("Synchronization failed");
            setError(
              response.message || "Failed to apply operation"
            );
            return;
          }

          const confirmedVersion =
            response.currentVersion ?? response.version;

          if (confirmedVersion === undefined) {
            firstPending.sent = false;
            setSaveStatus("Synchronization failed");
            setError(
              "Server did not return a document version"
            );
            return;
          }

          versionRef.current = Math.max(
            versionRef.current,
            confirmedVersion
          );

          pendingOperationsRef.current.shift();

          setDocument((currentDocument) => {
            if (!currentDocument) return currentDocument;

            return {
              ...currentDocument,
              version: versionRef.current,
            };
          });

          if (pendingOperationsRef.current.length === 0) {
            setSaveStatus("Synced");
          } else {
            setSaveStatus("Syncing...");
            sendNextOperation();
          }
        }
      );
    },
    [applyServerSnapshot, params.documentId]
  );

  useEffect(() => {
    const token = getToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!API_URL) return;

    const socket = io(API_URL, {
      auth: { token },
    });

    socketRef.current = socket;

    function integrateServerOperation(
      serverOperation: ServerOperation
    ) {
      if (serverOperation.version <= versionRef.current) {
        return;
      }

      if (serverOperation.baseVersion !== versionRef.current) {
        throw new Error(
          "A document version was missed during recovery"
        );
      }

      const firstPending =
        pendingOperationsRef.current[0];

      if (
        firstPending?.operationId ===
        serverOperation.operationId
      ) {
        pendingOperationsRef.current.shift();
        versionRef.current = serverOperation.version;

        setDocument((currentDocument) => {
          if (!currentDocument) return currentDocument;

          return {
            ...currentDocument,
            version: serverOperation.version,
          };
        });

        return;
      }

      let remoteOperation = TextOperation.fromJSON(
        serverOperation.operation
      );

      pendingOperationsRef.current =
        pendingOperationsRef.current.map(
          (pendingOperation) => {
            const [remotePrime, localPrime] =
              TextOperation.transform(
                remoteOperation,
                pendingOperation.operation
              );

            remoteOperation = remotePrime;

            return {
              ...pendingOperation,
              operation: localPrime,
            };
          }
        );

      const nextContent = remoteOperation.apply(
        contentRef.current
      );

      contentRef.current = nextContent;
      versionRef.current = serverOperation.version;

      setContent(nextContent);

      setDocument((currentDocument) => {
        if (!currentDocument) return currentDocument;

        return {
          ...currentDocument,
          content: nextContent,
          version: serverOperation.version,
        };
      });
    }

    function joinDocument() {
      setSaveStatus("Joining document...");

      const wasPreviouslyLoaded =
        hasLoadedDocumentRef.current;

      socket.emit(
        "document:join",
        {
          documentId: params.documentId,
          knownVersion: wasPreviouslyLoaded
            ? versionRef.current
            : undefined,
        },
        (response: JoinResponse) => {
          if (!response.ok || !response.document) {
            joinedRef.current = false;
            setIsJoined(false);
            setError(
              response.message || "Failed to join document"
            );
            return;
          }

          const joinedDocument = response.document;
          const serverContent = joinedDocument.content || "";
          const hadPendingOperations =
            pendingOperationsRef.current.length > 0;

          try {
            if (
              wasPreviouslyLoaded &&
              response.recovery?.historyAvailable
            ) {
              for (const missedOperation of
                response.recovery.missedOperations) {
                integrateServerOperation(missedOperation);
              }

              if (
                versionRef.current !== joinedDocument.version
              ) {
                throw new Error(
                  "Recovery did not reach the current server version"
                );
              }

              for (const pendingOperation of
                pendingOperationsRef.current) {
                pendingOperation.sent = false;
                pendingOperation.baseVersion = undefined;
              }
            } else {
              pendingOperationsRef.current = [];
              contentRef.current = serverContent;
              versionRef.current = joinedDocument.version;
              setContent(serverContent);
            }

            joinedRef.current = true;
            hasLoadedDocumentRef.current = true;

            setDocument({
              ...joinedDocument,
              content: contentRef.current,
              version: versionRef.current,
            });
            setTitle(joinedDocument.title);
            setActiveUsers(
              sortActiveUsers(response.activeUsers || [])
            );
            setIsJoined(true);

            if (
              wasPreviouslyLoaded &&
              !response.recovery?.historyAvailable &&
              hadPendingOperations
            ) {
              setError(
                "The server history was unavailable, so unconfirmed local edits were discarded."
              );
            } else {
              setError("");
            }

            if (pendingOperationsRef.current.length > 0) {
              setSaveStatus("Recovering edits...");
              sendNextOperation();
            } else {
              setSaveStatus(
                joinedDocument.access_role === "viewer"
                  ? "View only"
                  : "Synced"
              );
            }
          } catch (recoveryError) {
            pendingOperationsRef.current = [];
            contentRef.current = serverContent;
            versionRef.current = joinedDocument.version;
            joinedRef.current = true;
            hasLoadedDocumentRef.current = true;

            setDocument(joinedDocument);
            setTitle(joinedDocument.title);
            setContent(serverContent);
            setActiveUsers(
              sortActiveUsers(response.activeUsers || [])
            );
            setIsJoined(true);
            setSaveStatus("Resynchronized");
            setError(
              recoveryError instanceof Error
                ? recoveryError.message
                : "Reconnect recovery failed"
            );
          }
        }
      );
    }

    function removeDocumentAccess(message: string) {
      pendingOperationsRef.current = [];
      contentRef.current = "";
      joinedRef.current = false;
      hasLoadedDocumentRef.current = false;

      setDocument(null);
      setContent("");
      setActiveUsers([]);
      setIsJoined(false);
      setSaveStatus("Access removed");
      setError(message);
    }

    socket.on("connect", () => {
      setConnectionStatus("Connected");
      joinDocument();
    });

    socket.on("connect_error", (socketError) => {
      joinedRef.current = false;
      setIsJoined(false);
      setActiveUsers([]);
      setConnectionStatus("Connection failed");
      setError(socketError.message);
    });

    socket.on("disconnect", () => {
      joinedRef.current = false;
      setIsJoined(false);
      setActiveUsers([]);
      setConnectionStatus("Disconnected");
      setSaveStatus("Offline");
    });

    socket.on(
      "document:operation-applied",
      (event: OperationAppliedEvent) => {
        if (event.documentId !== params.documentId) return;

        try {
          integrateServerOperation(event);

          setSaveStatus(
            pendingOperationsRef.current.length === 0
              ? `Updated by ${event.updatedBy.name}`
              : "Syncing..."
          );
        } catch (operationError) {
          joinedRef.current = false;
          setIsJoined(false);
          setError(
            operationError instanceof Error
              ? operationError.message
              : "Failed to apply remote operation"
          );
        }
      }
    );

    socket.on(
      "presence:user-joined",
      (event: PresenceEvent) => {
        setActiveUsers((currentUsers) =>
          sortActiveUsers([
            ...currentUsers.filter(
              (user) => user.id !== event.user.id
            ),
            event.user,
          ])
        );
      }
    );

    socket.on(
      "presence:user-left",
      (event: PresenceEvent) => {
        setActiveUsers((currentUsers) =>
          currentUsers.filter(
            (user) => user.id !== event.user.id
          )
        );
      }
    );

    socket.on(
      "document:access-updated",
      (event: AccessUpdatedEvent) => {
        if (event.documentId !== params.documentId) return;

        pendingOperationsRef.current = [];
        setSaveStatus("Access updated");
        joinDocument();
      }
    );

    socket.on(
      "document:access-revoked",
      (event: DocumentEvent) => {
        if (event.documentId !== params.documentId) return;

        removeDocumentAccess(
          "Your access to this document was removed."
        );
      }
    );

    socket.on("document:deleted", (event: DocumentEvent) => {
      if (event.documentId !== params.documentId) return;

      removeDocumentAccess(
        "This document was deleted by its owner."
      );
    });

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      joinedRef.current = false;
      socket.disconnect();
    };
  }, [params.documentId, router, sendNextOperation]);

  function handleContentChange(
    event: ChangeEvent<HTMLTextAreaElement>
  ) {
    if (!document || document.access_role === "viewer") {
      return;
    }

    const previousContent = contentRef.current;
    const nextContent = event.target.value;

    if (previousContent === nextContent) return;

    pendingOperationsRef.current.push({
      operationId: crypto.randomUUID(),
      operation: TextOperation.fromDiff(
        previousContent,
        nextContent
      ),
      sent: false,
    });

    contentRef.current = nextContent;

    setContent(nextContent);
    setSaveStatus("Syncing...");
    setError("");

    sendNextOperation();
  }

  async function handleSaveTitle() {
    if (!document || document.access_role === "viewer") {
      return;
    }

    setError("");
    setSaveStatus("Saving title...");

    try {
      const result = await updateDocument(document.id, {
        title,
      });

      setDocument((currentDocument) => {
        if (!currentDocument) return result.document;

        return {
          ...currentDocument,
          title: result.document.title,
          updated_at: result.document.updated_at,
        };
      });

      setSaveStatus(
        pendingOperationsRef.current.length === 0
          ? "Synced"
          : "Syncing..."
      );
    } catch (saveError) {
      setSaveStatus("Title save failed");
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save title"
      );
    }
  }

  if (!document) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="text-center">
          <p className="text-slate-400">
            {error || "Connecting to document..."}
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm text-slate-400 underline"
          >
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const canEdit = document.access_role !== "viewer";

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <section className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href="/dashboard"
              className="text-sm text-slate-400 underline"
            >
              Back to dashboard
            </Link>

            <input
              className="mt-3 block w-full bg-transparent text-3xl font-bold outline-none disabled:text-slate-400"
              value={title}
              disabled={!canEdit}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaveStatus("Title unsaved");
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-400">
              Version {document.version} | {connectionStatus} |{" "}
              {saveStatus}
            </p>

            {canEdit && (
              <button
                onClick={handleSaveTitle}
                className="rounded-md bg-white px-4 py-2 font-medium text-slate-950"
              >
                Save title
              </button>
            )}
          </div>
        </header>

        <ActiveUsers users={activeUsers} />

        {document.access_role === "owner" && (
          <CollaboratorPanel documentId={document.id} />
        )}

        {error && (
          <p className="mt-4 rounded-md border border-red-900 bg-red-950 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <textarea
          className="mt-8 min-h-[65vh] w-full resize-none rounded-lg border border-slate-800 bg-slate-900 p-4 leading-7 outline-none focus:border-slate-600 disabled:cursor-not-allowed disabled:text-slate-400"
          value={content}
          disabled={!isJoined || !canEdit}
          onChange={handleContentChange}
          placeholder={
            canEdit
              ? "Start writing..."
              : "You have view-only access"
          }
        />
      </section>
    </main>
  );
}