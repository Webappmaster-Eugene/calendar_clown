/**
 * Catalog section of the Nutritionist page.
 *
 * Renders the user's product catalog (list + search + pagination),
 * create/edit form with optional package photo, and delete with
 * confirmation. Photos load via authed blob fetch so the InitData
 * Authorization header can be attached.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type {
  NutritionProductDto,
  NutritionProductsListResponse,
  NutritionProductUnit,
} from "@shared/types";

const PAGE_SIZE = 20;

interface FormState {
  id: number | null;
  name: string;
  description: string;
  unit: NutritionProductUnit;
  caloriesPer100: string;
  proteinsPer100G: string;
  fatsPer100G: string;
  carbsPer100G: string;
  file: File | null;
  removePhoto: boolean;
}

const emptyForm: FormState = {
  id: null,
  name: "",
  description: "",
  unit: "g",
  caloriesPer100: "",
  proteinsPer100G: "",
  fatsPer100G: "",
  carbsPer100G: "",
  file: null,
  removePhoto: false,
};

export function NutritionistCatalog() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["nutritionistProducts", offset, search],
    queryFn: () =>
      api.get<NutritionProductsListResponse>(
        `/api/nutritionist/products?limit=${PAGE_SIZE}&offset=${offset}` +
          (search ? `&search=${encodeURIComponent(search)}` : ""),
      ),
  });

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const maxAllowed = data?.maxAllowed ?? 200;

  const saveMutation = useMutation({
    mutationFn: async (state: FormState) => {
      const fd = buildFormData(state);
      if (state.id == null) {
        return api.upload<NutritionProductDto>("/api/nutritionist/products", fd);
      }
      return api.uploadPatch<NutritionProductDto>(
        `/api/nutritionist/products/${state.id}`,
        fd,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutritionistProducts"] });
      queryClient.invalidateQueries({ queryKey: ["nutritionistProductsCount"] });
      closeForm();
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Ошибка сохранения");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<{ deleted: boolean }>(`/api/nutritionist/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutritionistProducts"] });
      queryClient.invalidateQueries({ queryKey: ["nutritionistProductsCount"] });
    },
  });

  function openCreateForm() {
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(p: NutritionProductDto) {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      unit: p.unit,
      caloriesPer100: String(p.caloriesPer100),
      proteinsPer100G: String(p.proteinsPer100G),
      fatsPer100G: String(p.fatsPer100G),
      carbsPer100G: String(p.carbsPer100G),
      file: null,
      removePhoto: false,
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setForm(emptyForm);
    setFormError(null);
  }

  function handleSubmit() {
    const validation = validateForm(form);
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError(null);
    saveMutation.mutate(form);
  }

  function handleDelete(p: NutritionProductDto) {
    if (confirm(`Удалить продукт «${p.name}» из каталога?`)) {
      deleteMutation.mutate(p.id);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  return (
    <div>
      {/* Top bar: search + count + add */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="card-hint">
            {total} / {maxAllowed} продуктов
          </div>
          <button
            className="btn btn-small"
            onClick={openCreateForm}
            disabled={total >= maxAllowed}
            title={total >= maxAllowed ? "Достигнут лимит" : undefined}
          >
            ➕ Добавить
          </button>
        </div>
        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 6 }}>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Поиск по названию или описанию"
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--tg-theme-hint-color, #ccc)",
              background: "var(--tg-theme-bg-color, #fff)",
              color: "var(--tg-theme-text-color, #000)",
              fontSize: 14,
            }}
          />
          <button className="btn btn-small" type="submit">
            🔍
          </button>
        </form>
      </div>

      {isLoading && <div className="loading">Загрузка...</div>}

      {!isLoading && products.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-emoji">📦</div>
          <div className="empty-state-text">
            Каталог пуст. Добавьте свои продукты, чтобы AI использовал точные значения при анализе блюд.
          </div>
        </div>
      )}

      {products.length > 0 && (
        <div className="list">
          {products.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              onEdit={() => openEditForm(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="form-row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button
            className="btn btn-small"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ←
          </button>
          <span className="card-hint" style={{ padding: "0 8px" }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} из {total}
          </span>
          <button
            className="btn btn-small"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            →
          </button>
        </div>
      )}

      {formOpen && (
        <ProductFormModal
          form={form}
          setForm={setForm}
          error={formError}
          busy={saveMutation.isPending}
          onCancel={closeForm}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

// ─── Product row ─────────────────────────────────────────────────

function ProductRow({
  product,
  onEdit,
  onDelete,
}: {
  product: NutritionProductDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <PackageThumbnail productId={product.id} hasPhoto={product.hasPackagePhoto} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: 14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          onClick={onEdit}
        >
          {product.name}
        </div>
        {product.description && (
          <div
            className="card-hint"
            style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {product.description}
          </div>
        )}
        <div className="card-hint" style={{ fontSize: 12, marginTop: 4 }}>
          🔥 {product.caloriesPer100} ккал · Б {product.proteinsPer100G} · Ж {product.fatsPer100G} · У{" "}
          {product.carbsPer100G} / 100 {product.unit}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button className="btn btn-icon" onClick={onEdit} title="Изменить">
          ✏️
        </button>
        <button className="btn btn-icon btn-danger" onClick={onDelete} title="Удалить">
          🗑️
        </button>
      </div>
    </div>
  );
}

// ─── Package thumbnail (authed blob fetch) ───────────────────────

function PackageThumbnail({ productId, hasPhoto }: { productId: number; hasPhoto: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPhoto) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    api
      .getBlob(`/api/nutritionist/products/${productId}/photo`)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!revoked) setUrl(null);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [productId, hasPhoto]);

  const box: React.CSSProperties = {
    width: 52,
    height: 52,
    borderRadius: 8,
    flexShrink: 0,
    background: "var(--tg-theme-secondary-bg-color, #f2f2f2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    fontSize: 22,
  };

  if (url) {
    return <img src={url} alt="" style={{ ...box, objectFit: "cover" }} />;
  }
  return <div style={box}>📦</div>;
}

// ─── Product form modal ─────────────────────────────────────────

function ProductFormModal({
  form,
  setForm,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--tg-theme-bg-color, #fff)",
          color: "var(--tg-theme-text-color, #000)",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 16,
          boxSizing: "border-box",
          paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0))",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18 }}>
          {form.id == null ? "Новый продукт" : "Изменить продукт"}
        </h2>

        <Field label="Название *">
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Например: Молоко Простоквашино 2.5%"
            maxLength={200}
          />
        </Field>

        <Field label="Описание">
          <textarea
            className="input"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            maxLength={1000}
            placeholder="Опционально"
          />
        </Field>

        <Field label="Единица измерения *">
          <div style={{ display: "flex", gap: 6 }}>
            {(["g", "ml"] as NutritionProductUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                className={`btn btn-small ${form.unit === u ? "btn-primary" : ""}`}
                onClick={() => setForm((f) => ({ ...f, unit: u }))}
                style={{ flex: 1 }}
              >
                {u === "g" ? "грамм (g)" : "миллилитр (ml)"}
              </button>
            ))}
          </div>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label={`🔥 Калории / 100 ${form.unit}`}>
            <input
              className="input"
              value={form.caloriesPer100}
              onChange={(e) => setForm((f) => ({ ...f, caloriesPer100: e.target.value }))}
              inputMode="decimal"
              placeholder="0–900"
            />
          </Field>
          <Field label={`🥩 Белки / 100 ${form.unit}, г`}>
            <input
              className="input"
              value={form.proteinsPer100G}
              onChange={(e) => setForm((f) => ({ ...f, proteinsPer100G: e.target.value }))}
              inputMode="decimal"
              placeholder="0–100"
            />
          </Field>
          <Field label={`🧈 Жиры / 100 ${form.unit}, г`}>
            <input
              className="input"
              value={form.fatsPer100G}
              onChange={(e) => setForm((f) => ({ ...f, fatsPer100G: e.target.value }))}
              inputMode="decimal"
              placeholder="0–100"
            />
          </Field>
          <Field label={`🍞 Углеводы / 100 ${form.unit}, г`}>
            <input
              className="input"
              value={form.carbsPer100G}
              onChange={(e) => setForm((f) => ({ ...f, carbsPer100G: e.target.value }))}
              inputMode="decimal"
              placeholder="0–100"
            />
          </Field>
        </div>

        <Field label="Фото упаковки (опционально, только для вашей памяти)">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setForm((f) => ({ ...f, file, removePhoto: false }));
              e.target.value = "";
            }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button type="button" className="btn btn-small" onClick={() => fileInputRef.current?.click()}>
              📷 {form.file ? "Заменить" : "Выбрать фото"}
            </button>
            {form.file && (
              <span className="card-hint" style={{ fontSize: 12 }}>
                {form.file.name}
              </span>
            )}
            {form.id != null && !form.file && !form.removePhoto && (
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => setForm((f) => ({ ...f, removePhoto: true }))}
              >
                Удалить фото
              </button>
            )}
            {form.removePhoto && <span className="card-hint">фото будет удалено при сохранении</span>}
          </div>
        </Field>

        {error && (
          <div className="error-msg" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={onSubmit} disabled={busy}>
            {busy ? "Сохранение..." : form.id == null ? "Создать" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="card-hint" style={{ fontSize: 12, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ─── Form helpers ────────────────────────────────────────────────

function validateForm(form: FormState): string | null {
  if (!form.name.trim()) return "Название обязательно.";
  if (form.name.trim().length > 200) return "Название слишком длинное (макс. 200 символов).";
  if (form.description.length > 1000) return "Описание слишком длинное (макс. 1000 символов).";
  const ranges: Array<[string, string, number, number]> = [
    ["Калории", form.caloriesPer100, 0, 900],
    ["Белки", form.proteinsPer100G, 0, 100],
    ["Жиры", form.fatsPer100G, 0, 100],
    ["Углеводы", form.carbsPer100G, 0, 100],
  ];
  for (const [label, raw, min, max] of ranges) {
    if (raw === "") return `${label} обязательны.`;
    const num = Number(raw.replace(",", "."));
    if (!Number.isFinite(num)) return `${label} должны быть числом.`;
    if (num < min || num > max) return `${label} должны быть в диапазоне ${min}–${max}.`;
  }
  return null;
}

function buildFormData(form: FormState): FormData {
  const fd = new FormData();
  fd.append("name", form.name.trim());
  if (form.description.trim()) fd.append("description", form.description.trim());
  else if (form.id != null) fd.append("description", ""); // explicit clear on edit
  fd.append("unit", form.unit);
  fd.append("caloriesPer100", form.caloriesPer100.replace(",", "."));
  fd.append("proteinsPer100G", form.proteinsPer100G.replace(",", "."));
  fd.append("fatsPer100G", form.fatsPer100G.replace(",", "."));
  fd.append("carbsPer100G", form.carbsPer100G.replace(",", "."));
  if (form.file) fd.append("image", form.file);
  if (form.removePhoto && !form.file) fd.append("removePhoto", "1");
  return fd;
}

// Re-export ApiError type indirectly so consumers can narrow if needed.
export type NutritionistCatalogError = ApiError;
