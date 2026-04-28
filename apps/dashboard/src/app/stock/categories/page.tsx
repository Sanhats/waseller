"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";

type CategoryRow = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

function authHeaders(): HeadersInit | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return {
    Authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    "Content-Type": "application/json",
  };
}

function buildCategoryTreeIndex(rows: CategoryRow[]) {
  const byId = new Map<string, CategoryRow>();
  const childrenByParent = new Map<string | null, CategoryRow[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    const k = r.parentId ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(r);
  }
  for (const [, list] of childrenByParent) {
    list.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es"),
    );
  }
  return { byId, childrenByParent };
}

export default function StockCategoriesPage() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editSort, setEditSort] = useState(0);
  const [editActive, setEditActive] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getClientApiBase()}/categories`, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      setRows((await res.json()) as CategoryRow[]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las categorías");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const treeIndex = useMemo(() => buildCategoryTreeIndex(rows), [rows]);

  const flattened = useMemo(() => {
    const out: Array<{ row: CategoryRow; depth: number; isLast: boolean }> = [];
    const visit = (parentId: string | null, depth: number) => {
      const kids = treeIndex.childrenByParent.get(parentId) ?? [];
      kids.forEach((kid, idx) => {
        const isLast = idx === kids.length - 1;
        out.push({ row: kid, depth, isLast });
        visit(kid.id, depth + 1);
      });
    };
    visit(null, 0);
    return out;
  }, [treeIndex]);

  const depthById = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of flattened) m.set(it.row.id, it.depth);
    return m;
  }, [flattened]);

  const hasChildren = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.parentId) s.add(r.parentId);
    }
    return s;
  }, [rows]);

  const visible = useMemo(() => {
    if (collapsedIds.size === 0) return flattened;
    const isHidden = (row: CategoryRow): boolean => {
      let cur = row.parentId ? treeIndex.byId.get(row.parentId) ?? null : null;
      while (cur) {
        if (collapsedIds.has(cur.id)) return true;
        cur = cur.parentId ? treeIndex.byId.get(cur.parentId) ?? null : null;
      }
      return false;
    };
    return flattened.filter((x) => !isHidden(x.row));
  }, [collapsedIds, flattened, treeIndex.byId]);

  const parentOptions = (excludeId?: string) =>
    flattened.map((x) => x.row).filter((r) => !excludeId || r.id !== excludeId);

  const createCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const headers = authHeaders();
    if (!headers) return;
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch(`${getClientApiBase()}/categories`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          parentId: newParentId || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewName("");
      setNewParentId("");
      await load();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (r: CategoryRow) => {
    setEditingId(r.id);
    setEditName(r.name);
    setEditParentId(r.parentId ?? "");
    setEditSort(r.sortOrder);
    setEditActive(r.isActive);
  };

  const saveEdit = async () => {
    const headers = authHeaders();
    if (!headers || !editingId) return;
    try {
      const res = await fetch(`${getClientApiBase()}/categories/${editingId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: editName.trim(),
          parentId: editParentId || null,
          sortOrder: editSort,
          isActive: editActive,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingId(null);
      await load();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  const remove = async (id: string) => {
    const headers = authHeaders();
    if (!headers) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm("¿Eliminar esta categoría? Se quitará de los productos vinculados.")) return;
    try {
      const res = await fetch(`${getClientApiBase()}/categories/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  };

  return (
    <main
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        display: "flex",
        flexDirection: isMobile ? "column-reverse" : "row",
      }}
    >
      <AppSidebar active="stock" compact={isMobile} />
      <section
        style={{
          flex: 1,
          backgroundColor: "var(--color-bg)",
          color: "var(--color-text)",
          padding: isMobile ? 14 : 24,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.3 }}>Categorías</h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--color-muted)" }}>
              Árbol por tenant: usalas para filtrar inventario y el catálogo público.
            </p>
          </div>
          <Link
            href="/stock"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-primary)",
              textDecoration: "none",
            }}
          >
            ← Inventario
          </Link>
        </div>

        {loading ? <Spinner className="mt-4" size="sm" label="Cargando" /> : null}
        {error ? (
          <p style={{ color: "var(--color-error)", marginTop: 12 }} role="alert">
            {error}
          </p>
        ) : null}

        <form
          onSubmit={(ev) => void createCategory(ev)}
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxWidth: 520,
          }}
        >
          <strong style={{ fontSize: 15 }}>Nueva categoría</strong>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Nombre
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 14,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Padre (opcional)
            <select
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 14,
              }}
            >
              <option value="">— Raíz —</option>
              {parentOptions().map((r) => {
                const depth = depthById.get(r.id) ?? 0;
                const pad = `${"— ".repeat(depth)}`;
                return (
                  <option key={r.id} value={r.id}>
                    {pad}
                    {r.name}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "var(--color-primary)",
              color: "var(--color-surface)",
              fontWeight: 600,
              cursor: creating ? "wait" : "pointer",
            }}
          >
            {creating ? "Creando…" : "Crear"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: "var(--color-surface)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ backgroundColor: "var(--color-bg)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px" }}>Categoría</th>
                <th style={{ padding: "10px 12px" }}>Slug</th>
                <th style={{ padding: "10px 12px" }}>Orden</th>
                <th style={{ padding: "10px 12px" }}>Activa</th>
                <th style={{ padding: "10px 12px" }} />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row: r, depth, isLast }) => {
                const prefix =
                  depth === 0
                    ? ""
                    : `${"│ ".repeat(Math.max(0, depth - 1))}${isLast ? "└─ " : "├─ "}`;
                const isEdit = editingId === r.id;
                const canToggle = hasChildren.has(r.id);
                const isCollapsed = collapsedIds.has(r.id);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>
                      {isEdit ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ width: "100%", maxWidth: 280, padding: 6, borderRadius: 6, border: "1px solid var(--color-border)" }}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (!canToggle) return;
                              setCollapsedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.id)) next.delete(r.id);
                                else next.add(r.id);
                                return next;
                              });
                            }}
                            aria-label={
                              canToggle
                                ? isCollapsed
                                  ? `Expandir ${r.name}`
                                  : `Colapsar ${r.name}`
                                : `Sin subcategorías`
                            }
                            disabled={!canToggle}
                            style={{
                              width: 22,
                              height: 22,
                              marginRight: 6,
                              borderRadius: 6,
                              border: "1px solid var(--color-border)",
                              background: canToggle ? "var(--color-surface)" : "transparent",
                              color: "var(--color-muted)",
                              cursor: canToggle ? "pointer" : "default",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              verticalAlign: "middle",
                              opacity: canToggle ? 1 : 0.35
                            }}
                          >
                            {canToggle ? (isCollapsed ? "▶" : "▼") : "•"}
                          </button>
                          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--color-muted)" }}>
                            {prefix}
                          </span>
                          {r.name}
                        </>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--color-muted)", fontFamily: "monospace", fontSize: 13 }}>
                      {r.slug}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {isEdit ? (
                        <input
                          type="number"
                          value={editSort}
                          onChange={(e) => setEditSort(Number(e.target.value))}
                          style={{ width: 72, padding: 6, borderRadius: 6, border: "1px solid var(--color-border)" }}
                        />
                      ) : (
                        r.sortOrder
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {isEdit ? (
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                          activa
                        </label>
                      ) : r.isActive ? (
                        "Sí"
                      ) : (
                        "No"
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      {isEdit ? (
                        <>
                          <label style={{ display: "block", marginBottom: 6, fontSize: 12 }}>
                            Padre
                            <select
                              value={editParentId}
                              onChange={(e) => setEditParentId(e.target.value)}
                              style={{ marginLeft: 6, padding: 4, borderRadius: 6, border: "1px solid var(--color-border)" }}
                            >
                              <option value="">— Raíz —</option>
                              {parentOptions(r.id).map((o) => (
                                <option key={o.id} value={o.id}>
                                  {("— ".repeat(depthById.get(o.id) ?? 0)) + o.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => void saveEdit()}
                            style={{
                              marginRight: 8,
                              padding: "4px 10px",
                              borderRadius: 6,
                              border: "none",
                              backgroundColor: "var(--color-primary)",
                              color: "var(--color-surface)",
                              cursor: "pointer",
                            }}
                          >
                            Guardar
                          </button>
                          <button type="button" onClick={() => setEditingId(null)} style={{ cursor: "pointer" }}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            style={{ marginRight: 8, cursor: "pointer", fontWeight: 600, color: "var(--color-primary)", background: "none", border: "none" }}
                          >
                            Editar
                          </button>
                          <button type="button" onClick={() => void remove(r.id)} style={{ cursor: "pointer", color: "var(--color-error)", background: "none", border: "none" }}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && visible.length === 0 ? (
            <p style={{ padding: 20, margin: 0, color: "var(--color-muted)" }}>Todavía no hay categorías.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
