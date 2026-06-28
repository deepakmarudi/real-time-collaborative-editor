export type ActiveUser = {
  id: string;
  name: string;
  email?: string;
};

type ActiveUsersProps = {
  users: ActiveUser[];
};

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "?";

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export function ActiveUsers({
  users,
}: ActiveUsersProps) {
  return (
    <section
      className="mt-4 flex min-h-10 flex-wrap items-center gap-3 border-y border-slate-800 py-3"
      aria-label="Active collaborators"
    >
      <p className="text-sm text-slate-400">
        Active now: {users.length}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-2"
            title={
              user.email
                ? `${user.name} (${user.email})`
                : user.name
            }
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
              {getInitials(user.name)}
            </span>

            <span className="max-w-32 truncate text-sm text-slate-300">
              {user.name}
            </span>
          </div>
        ))}

        {users.length === 0 && (
          <p className="text-sm text-slate-500">
            Nobody else is connected.
          </p>
        )}
      </div>
    </section>
  );
}