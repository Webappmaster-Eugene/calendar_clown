import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  NutritionAnalysisDto,
  NutritionProductsListResponse,
  NutritionProductDto,
  ManualCalcRequest,
} from "@shared/types";

// ─── Types ──────────────────────────────────────────────────────

interface CalcItem {
  localId: string;
  name: string;
  weightG: string;
  caloriesPer100: string;
  proteinsPer100G: string;
  fatsPer100G: string;
  carbsPer100G: string;
  catalogProductId?: number;
  expanded: boolean;
}

interface ItemMacros {
  weightG: number;
  calories: number;
  proteinsG: number;
  fatsG: number;
  carbsG: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function parseNum(s: string): number {
  return parseFloat(s.replace(",", ".")) || 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function computeItemMacros(item: CalcItem): ItemMacros {
  const w = parseNum(item.weightG);
  const factor = w / 100;
  return {
    weightG: w,
    calories: Math.round(parseNum(item.caloriesPer100) * factor),
    proteinsG: round1(parseNum(item.proteinsPer100G) * factor),
    fatsG: round1(parseNum(item.fatsPer100G) * factor),
    carbsG: round1(parseNum(item.carbsPer100G) * factor),
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyItem(expanded: boolean): CalcItem {
  return {
    localId: newId(),
    name: "",
    weightG: "",
    caloriesPer100: "",
    proteinsPer100G: "",
    fatsPer100G: "",
    carbsPer100G: "",
    expanded,
  };
}

function itemFromProduct(p: NutritionProductDto): CalcItem {
  return {
    localId: newId(),
    name: p.name,
    weightG: "100",
    caloriesPer100: String(p.caloriesPer100),
    proteinsPer100G: String(p.proteinsPer100G),
    fatsPer100G: String(p.fatsPer100G),
    carbsPer100G: String(p.carbsPer100G),
    catalogProductId: p.id,
    expanded: false,
  };
}

// ─── Component ──────────────────────────────────────────────────

export function NutritionistCalculator({ onGoToCatalog }: { onGoToCatalog: () => void }) {
  const queryClient = useQueryClient();

  const [mealName, setMealName] = useState("");
  const [items, setItems] = useState<CalcItem[]>([]);
  const [servings, setServings] = useState("1");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Computed totals ──
  const itemsMacros = useMemo(() => items.map(computeItemMacros), [items]);

  const fullTotal = useMemo(() => {
    const t = { weightG: 0, calories: 0, proteinsG: 0, fatsG: 0, carbsG: 0 };
    for (const m of itemsMacros) {
      t.weightG += m.weightG;
      t.calories += m.calories;
      t.proteinsG += m.proteinsG;
      t.fatsG += m.fatsG;
      t.carbsG += m.carbsG;
    }
    t.weightG = round1(t.weightG);
    t.proteinsG = round1(t.proteinsG);
    t.fatsG = round1(t.fatsG);
    t.carbsG = round1(t.carbsG);
    return t;
  }, [itemsMacros]);

  const servingsNum = Math.max(1, Math.round(parseNum(servings)) || 1);
  const perServingTotal = useMemo(() => {
    if (servingsNum <= 1) return fullTotal;
    return {
      weightG: round1(fullTotal.weightG / servingsNum),
      calories: Math.round(fullTotal.calories / servingsNum),
      proteinsG: round1(fullTotal.proteinsG / servingsNum),
      fatsG: round1(fullTotal.fatsG / servingsNum),
      carbsG: round1(fullTotal.carbsG / servingsNum),
    };
  }, [fullTotal, servingsNum]);

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: (req: ManualCalcRequest) =>
      api.post<NutritionAnalysisDto>("/api/nutritionist/manual", req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutritionist"] });
      queryClient.invalidateQueries({ queryKey: ["nutritionist-daily"] });
      setItems([]);
      setMealName("");
      setServings("1");
      setError(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // ── Handlers ──
  function updateItem(localId: string, patch: Partial<CalcItem>) {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((it) => it.localId !== localId));
  }

  function addManualItem() {
    setItems((prev) => [...prev, emptyItem(true)]);
  }

  function addFromCatalog(product: NutritionProductDto) {
    setItems((prev) => [...prev, itemFromProduct(product)]);
    setPickerOpen(false);
  }

  function handleSave() {
    setError(null);

    const validItems = items.filter((it) => it.name.trim() && parseNum(it.weightG) > 0);
    if (validItems.length === 0) {
      setError("Добавьте хотя бы один продукт с весом.");
      return;
    }

    const req: ManualCalcRequest = {
      mealName: mealName.trim() || undefined,
      items: validItems.map((it) => ({
        name: it.name.trim(),
        weightG: parseNum(it.weightG),
        caloriesPer100: parseNum(it.caloriesPer100),
        proteinsPer100G: parseNum(it.proteinsPer100G),
        fatsPer100G: parseNum(it.fatsPer100G),
        carbsPer100G: parseNum(it.carbsPer100G),
        ...(it.catalogProductId !== undefined ? { catalogProductId: it.catalogProductId } : {}),
      })),
      servings: servingsNum > 1 ? servingsNum : undefined,
    };

    saveMutation.mutate(req);
  }

  // ── Render ──
  return (
    <div>
      {/* Meal name */}
      <div className="card" style={{ marginBottom: 12 }}>
        <input
          className="input"
          value={mealName}
          onChange={(e) => setMealName(e.target.value)}
          placeholder="Название блюда (необязательно)"
          maxLength={200}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>

      {/* Items list */}
      {items.map((item, idx) => {
        const macros = itemsMacros[idx];
        return (
          <div key={item.localId} className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  className="input"
                  value={item.name}
                  onChange={(e) => updateItem(item.localId, { name: e.target.value })}
                  placeholder="Продукт"
                  maxLength={200}
                  style={{ width: "100%", boxSizing: "border-box", marginBottom: 6 }}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="input"
                    value={item.weightG}
                    onChange={(e) => updateItem(item.localId, { weightG: e.target.value })}
                    placeholder="Вес, г"
                    inputMode="decimal"
                    style={{ width: 80 }}
                  />
                  <span className="card-hint" style={{ fontSize: 12 }}>г</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, paddingTop: 4 }}>
                <button
                  className="btn btn-icon"
                  onClick={() => updateItem(item.localId, { expanded: !item.expanded })}
                  title={item.expanded ? "Свернуть" : "КБЖУ / 100г"}
                  type="button"
                  style={{ fontSize: 14 }}
                >
                  {item.expanded ? "▲" : "⚙️"}
                </button>
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => removeItem(item.localId)}
                  title="Удалить"
                  type="button"
                >
                  🗑️
                </button>
              </div>
            </div>

            {/* Per-100g fields (expanded) */}
            {item.expanded && (
              <div style={{ marginTop: 8 }}>
                <div className="card-hint" style={{ fontSize: 12, marginBottom: 6 }}>
                  КБЖУ на 100г:
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                  <div>
                    <div className="card-hint" style={{ fontSize: 11 }}>🔥 Ккал</div>
                    <input
                      className="input"
                      value={item.caloriesPer100}
                      onChange={(e) => updateItem(item.localId, { caloriesPer100: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <div className="card-hint" style={{ fontSize: 11 }}>Б</div>
                    <input
                      className="input"
                      value={item.proteinsPer100G}
                      onChange={(e) => updateItem(item.localId, { proteinsPer100G: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <div className="card-hint" style={{ fontSize: 11 }}>Ж</div>
                    <input
                      className="input"
                      value={item.fatsPer100G}
                      onChange={(e) => updateItem(item.localId, { fatsPer100G: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <div className="card-hint" style={{ fontSize: 11 }}>У</div>
                    <input
                      className="input"
                      value={item.carbsPer100G}
                      onChange={(e) => updateItem(item.localId, { carbsPer100G: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Live macros for this item */}
            {macros && macros.weightG > 0 && (
              <div className="card-hint" style={{ marginTop: 6, fontSize: 13 }}>
                🔥 {macros.calories} ккал | Б {macros.proteinsG}г | Ж {macros.fatsG}г | У {macros.carbsG}г
              </div>
            )}

            {item.catalogProductId != null && (
              <div
                className="card-hint"
                style={{
                  marginTop: 4,
                  fontSize: 10,
                  color: "#2e7d32",
                }}
              >
                🎯 из каталога
              </div>
            )}
          </div>
        );
      })}

      {/* Add item buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => setPickerOpen(true)} type="button">
          📦 Из каталога
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={addManualItem} type="button">
          ✏️ Вручную
        </button>
      </div>

      {/* Servings */}
      {items.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>Порций:</span>
            <input
              className="input"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              inputMode="numeric"
              style={{ width: 60, textAlign: "center" }}
            />
            {servingsNum > 1 && (
              <span className="card-hint" style={{ fontSize: 12 }}>
                (итого делится на {servingsNum})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Totals */}
      {items.length > 0 && fullTotal.calories > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          {servingsNum > 1 && (
            <>
              <div className="card-hint" style={{ marginBottom: 4, fontSize: 12 }}>
                Всего ({servingsNum} порций):
              </div>
              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 8 }}>
                {fullTotal.weightG}г — {fullTotal.calories} ккал |
                Б {fullTotal.proteinsG}г | Ж {fullTotal.fatsG}г | У {fullTotal.carbsG}г
              </div>
              <div style={{
                borderTop: "1px solid var(--tg-theme-hint-color, #eee)",
                paddingTop: 8,
              }}>
                <div className="card-hint" style={{ marginBottom: 4, fontSize: 12 }}>
                  На 1 порцию:
                </div>
              </div>
            </>
          )}
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {servingsNum <= 1 ? "Итого: " : ""}
            {perServingTotal.weightG}г — {perServingTotal.calories} ккал |
            Б {perServingTotal.proteinsG}г | Ж {perServingTotal.fatsG}г | У {perServingTotal.carbsG}г
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}

      {/* Success */}
      {saveSuccess && (
        <div
          style={{
            marginBottom: 8,
            padding: "8px 12px",
            borderRadius: 8,
            background: "#4CAF5020",
            color: "#4CAF50",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Расчёт сохранён и добавлен в историю
        </div>
      )}

      {/* Save */}
      {items.length > 0 && (
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginBottom: 16 }}
          onClick={handleSave}
          disabled={saveMutation.isPending}
          type="button"
        >
          {saveMutation.isPending ? "Сохраняю..." : "💾 Сохранить"}
        </button>
      )}

      {/* Empty state */}
      {items.length === 0 && !saveSuccess && (
        <div className="empty-state">
          <div className="empty-state-emoji">🧮</div>
          <div className="empty-state-text">
            Добавьте продукты для расчёта КБЖУ
          </div>
        </div>
      )}

      {/* Product picker modal */}
      {pickerOpen && (
        <ProductPickerModal
          onSelect={addFromCatalog}
          onClose={() => setPickerOpen(false)}
          onGoToCatalog={onGoToCatalog}
        />
      )}
    </div>
  );
}

// ─── Product Picker Modal ───────────────────────────────────────

function ProductPickerModal({
  onSelect,
  onClose,
  onGoToCatalog,
}: {
  onSelect: (product: NutritionProductDto) => void;
  onClose: () => void;
  onGoToCatalog: () => void;
}) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["nutritionistProductsPicker", search],
    queryFn: () =>
      api.get<NutritionProductsListResponse>(
        `/api/nutritionist/products?limit=50&offset=0${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
  });

  const products = data?.products ?? [];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <div
      onClick={onClose}
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
          maxHeight: "80vh",
          overflowY: "auto",
          padding: 16,
          boxSizing: "border-box",
          paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0))",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18 }}>
          Выбрать из каталога
        </h2>

        {/* Search */}
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input
            className="input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Поиск..."
            style={{ flex: 1 }}
          />
          <button className="btn btn-small" type="submit">🔍</button>
        </form>

        {isLoading && <div className="loading">Загрузка...</div>}

        {!isLoading && products.length === 0 && (
          <div className="empty-state" style={{ padding: "24px 0" }}>
            <div className="empty-state-emoji">📦</div>
            <div className="empty-state-text" style={{ marginBottom: 8 }}>
              {search ? "Ничего не найдено" : "Каталог пуст"}
            </div>
            {!search && (
              <button
                className="btn btn-small"
                onClick={() => {
                  onClose();
                  onGoToCatalog();
                }}
                type="button"
              >
                Перейти в каталог →
              </button>
            )}
          </div>
        )}

        {products.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p)}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid var(--tg-theme-hint-color, #eee)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</div>
            <div className="card-hint" style={{ fontSize: 12 }}>
              🔥 {p.caloriesPer100} ккал · Б {p.proteinsPer100G} · Ж {p.fatsPer100G} · У {p.carbsPer100G} / 100{p.unit}
            </div>
          </div>
        ))}

        <button
          className="btn"
          style={{ width: "100%", marginTop: 12 }}
          onClick={onClose}
          type="button"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
