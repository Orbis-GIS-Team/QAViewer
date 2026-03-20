import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { Session, UserRole } from "../App";
import { apiRequest } from "../lib/api";

type ManagedUser = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  commentCount: number;
  documentCount: number;
};

type UserPayload = {
  users: ManagedUser[];
};

type UserResponse = {
  user: ManagedUser;
};

type UserDraft = {
  name: string;
  email: string;
  role: UserRole;
  password: string;
};

type AdminWorkspaceProps = {
  session: Session;
  onLogout: () => void;
  onOpenReview: () => void;
  onSessionUpdate: (user: Session["user"]) => void;
};

const ROLE_OPTIONS: UserRole[] = ["admin", "reviewer", "client"];

function emptyUserDraft(role: UserRole = "reviewer"): UserDraft {
  return {
    name: "",
    email: "",
    role,
    password: "",
  };
}

function labelRole(role: UserRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function summarizeActivity(user: ManagedUser): string {
  const parts: string[] = [];

  if (user.commentCount > 0) {
    parts.push(`${user.commentCount} comments`);
  }
  if (user.documentCount > 0) {
    parts.push(`${user.documentCount} documents`);
  }

  return parts.length > 0 ? parts.join(" | ") : "No authored activity yet";
}

export function AdminWorkspace({
  session,
  onLogout,
  onOpenReview,
  onSessionUpdate,
}: AdminWorkspaceProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [createDraft, setCreateDraft] = useState<UserDraft>(() => emptyUserDraft());
  const [editDraft, setEditDraft] = useState<UserDraft>(() => emptyUserDraft());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState({
    loading: false,
    creating: false,
    saving: false,
    deleting: false,
  });

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const roleCounts = users.reduce<Record<UserRole, number>>(
    (counts, user) => {
      counts[user.role] += 1;
      return counts;
    },
    { admin: 0, reviewer: 0, client: 0 },
  );

  async function loadUsers(preferredSelection?: number | null) {
    setBusy((current) => ({ ...current, loading: true }));

    try {
      const payload = await apiRequest<UserPayload>("/admin/users", {
        token: session.token,
      });

      setUsers(payload.users);
      setSelectedUserId((current) => {
        const nextSelection = preferredSelection !== undefined ? preferredSelection : current;
        if (nextSelection && payload.users.some((user) => user.id === nextSelection)) {
          return nextSelection;
        }
        return payload.users[0]?.id ?? null;
      });
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load users.");
    } finally {
      setBusy((current) => ({ ...current, loading: false }));
    }
  }

  useEffect(() => {
    void loadUsers();
  }, [session.token]);

  useEffect(() => {
    if (!selectedUser) {
      setEditDraft(emptyUserDraft());
      return;
    }

    setEditDraft({
      name: selectedUser.name,
      email: selectedUser.email,
      role: selectedUser.role,
      password: "",
    });
  }, [selectedUser]);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy((current) => ({ ...current, creating: true }));

    try {
      const payload = await apiRequest<UserResponse>("/admin/users", {
        method: "POST",
        token: session.token,
        body: createDraft,
      });

      setCreateDraft(emptyUserDraft());
      await loadUsers(payload.user.id);
      setFeedback(`Created ${payload.user.name}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to create user.");
    } finally {
      setBusy((current) => ({ ...current, creating: false }));
    }
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedUser) {
      return;
    }

    setBusy((current) => ({ ...current, saving: true }));

    const body: Partial<UserDraft> = {
      name: editDraft.name,
      email: editDraft.email,
      role: editDraft.role,
    };
    if (editDraft.password.trim()) {
      body.password = editDraft.password;
    }

    try {
      const payload = await apiRequest<UserResponse>(`/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        token: session.token,
        body,
      });

      if (selectedUser.id === session.user.id) {
        onSessionUpdate(payload.user);
      }

      await loadUsers(payload.user.id);
      setFeedback(`Updated ${payload.user.name}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to update user.");
    } finally {
      setBusy((current) => ({ ...current, saving: false }));
    }
  }

  async function handleDeleteUser() {
    if (!selectedUser) {
      return;
    }

    const confirmed = window.confirm(`Delete ${selectedUser.name}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setBusy((current) => ({ ...current, deleting: true }));

    try {
      await apiRequest<void>(`/admin/users/${selectedUser.id}`, {
        method: "DELETE",
        token: session.token,
      });

      const deletedName = selectedUser.name;
      await loadUsers();
      setFeedback(`Deleted ${deletedName}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to delete user.");
    } finally {
      setBusy((current) => ({ ...current, deleting: false }));
    }
  }

  const deleteBlocked =
    !selectedUser ||
    selectedUser.id === session.user.id ||
    selectedUser.commentCount > 0 ||
    selectedUser.documentCount > 0 ||
    (selectedUser.role === "admin" && roleCounts.admin <= 1);

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">QAViewer</p>
          <h1>Administration console</h1>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={onOpenReview} type="button">
            Review workspace
          </button>
          <div className="user-chip">
            <span>{session.user.name}</span>
            <small>{session.user.role}</small>
          </div>
          <button className="ghost-button" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
      </header>

      <section className="admin-grid">
        <aside className="workspace-panel">
          <section className="panel-section admin-stats-grid">
            <div className="stat-card">
              <span>Total users</span>
              <strong>{busy.loading ? "..." : users.length}</strong>
            </div>
            <div className="stat-card">
              <span>Admins</span>
              <strong>{busy.loading ? "..." : roleCounts.admin}</strong>
            </div>
            <div className="stat-card">
              <span>Reviewers</span>
              <strong>{busy.loading ? "..." : roleCounts.reviewer}</strong>
            </div>
            <div className="stat-card">
              <span>Clients</span>
              <strong>{busy.loading ? "..." : roleCounts.client}</strong>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <h2>Users</h2>
              <span>{busy.loading ? "Refreshing..." : `${users.length} loaded`}</span>
            </div>
            <div className="result-list">
              {users.map((user) => (
                <button
                  key={user.id}
                  className={`list-card user-card ${user.id === selectedUserId ? "selected" : ""}`}
                  onClick={() => setSelectedUserId(user.id)}
                  type="button"
                >
                  <div className="user-card-head">
                    <strong>{user.name}</strong>
                    <span className={`badge role-badge role-${user.role}`}>{labelRole(user.role)}</span>
                  </div>
                  <span>{user.email}</span>
                  <small>
                    {user.id === session.user.id ? "Current account | " : ""}
                    {summarizeActivity(user)}
                  </small>
                </button>
              ))}
              {!busy.loading && users.length === 0 ? (
                <p className="empty-state">No users are available yet.</p>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="workspace-panel">
          <section className="panel-section">
            <div className="section-heading">
              <h2>Create user</h2>
              <span>Admin only</span>
            </div>
            <form className="form-stack" onSubmit={handleCreateUser}>
              <label>
                Name
                <input
                  value={createDraft.name}
                  onChange={(event) =>
                    setCreateDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <div className="admin-form-grid">
                <label>
                  Email
                  <input
                    value={createDraft.email}
                    onChange={(event) =>
                      setCreateDraft((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Role
                  <select
                    value={createDraft.role}
                    onChange={(event) =>
                      setCreateDraft((current) => ({
                        ...current,
                        role: event.target.value as UserRole,
                      }))
                    }
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {labelRole(role)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Password
                <input
                  type="password"
                  value={createDraft.password}
                  onChange={(event) =>
                    setCreateDraft((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
              <button className="primary-button" disabled={busy.creating} type="submit">
                {busy.creating ? "Creating..." : "Create user"}
              </button>
            </form>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <h2>Edit user</h2>
              <span>{selectedUser ? selectedUser.email : "Select a user"}</span>
            </div>

            {selectedUser ? (
              <>
                <div className="admin-user-meta">
                  <span>
                    Created {new Date(selectedUser.createdAt).toLocaleDateString()}
                  </span>
                  <span>{summarizeActivity(selectedUser)}</span>
                </div>

                <form className="form-stack" onSubmit={handleSaveUser}>
                  <label>
                    Name
                    <input
                      value={editDraft.name}
                      onChange={(event) =>
                        setEditDraft((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <div className="admin-form-grid">
                    <label>
                      Email
                      <input
                        value={editDraft.email}
                        onChange={(event) =>
                          setEditDraft((current) => ({ ...current, email: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Role
                      <select
                        value={editDraft.role}
                        onChange={(event) =>
                          setEditDraft((current) => ({
                            ...current,
                            role: event.target.value as UserRole,
                          }))
                        }
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {labelRole(role)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    New password
                    <input
                      type="password"
                      placeholder="Leave blank to keep the current password"
                      value={editDraft.password}
                      onChange={(event) =>
                        setEditDraft((current) => ({ ...current, password: event.target.value }))
                      }
                    />
                  </label>
                  <button className="primary-button" disabled={busy.saving} type="submit">
                    {busy.saving ? "Saving..." : "Save user changes"}
                  </button>
                </form>

                <div className="admin-danger-zone">
                  <div>
                    <h3>Delete user</h3>
                    <p>
                      Delete is blocked for the current admin, the last admin, and users with
                      authored records.
                    </p>
                  </div>
                  <button
                    className="danger-button"
                    disabled={deleteBlocked}
                    onClick={handleDeleteUser}
                    type="button"
                  >
                    {busy.deleting ? "Deleting..." : "Delete user"}
                  </button>
                </div>
              </>
            ) : (
              <p className="empty-state">Choose a user from the list to edit their account.</p>
            )}
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <h2>Admin status</h2>
              <span>System feedback</span>
            </div>
            <p className="panel-note">
              {feedback ?? "Admin controls are ready. Changes apply immediately after save."}
            </p>
          </section>
        </section>
      </section>
    </main>
  );
}
