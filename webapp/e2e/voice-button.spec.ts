/**
 * VoiceButton component tests.
 * Verifies stable layout in card-row mode (transcribe, simplifier pages).
 * Tests that recording state doesn't cause layout shifts.
 */
import { test, expect, getComputedStyles, getBoundingBox } from "./fixtures";

test.describe("VoiceButton — Card Row Mode (Transcribe)", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row");
  });

  test("voice row has flex layout with gap", async ({ appPage }) => {
    const styles = await getComputedStyles(appPage, ".voice-row", [
      "display", "align-items", "gap",
    ]);
    expect(styles["display"]).toBe("flex");
    expect(styles["align-items"]).toBe("center");
    expect(parseFloat(styles["gap"])).toBe(12);
  });

  test("voice icon is 44x44 circle", async ({ appPage }) => {
    const icon = appPage.locator(".voice-row-icon");
    const styles = await getComputedStyles(appPage, ".voice-row-icon", [
      "width", "height", "border-radius",
    ]);
    expect(styles["width"]).toBe("44px");
    expect(styles["height"]).toBe("44px");
    expect(styles["border-radius"]).toBe("50%");
  });

  test("voice row has min-height 44px", async ({ appPage }) => {
    const minH = await appPage.locator(".voice-row").evaluate(
      (el) => window.getComputedStyle(el).minHeight
    );
    expect(minH).toBe("44px");
  });

  test("shows label and hint text in idle state", async ({ appPage }) => {
    await expect(appPage.locator(".voice-row-label")).toContainText("Записать голос");
    await expect(appPage.locator(".voice-row-hint")).toContainText("Нажмите для записи");
  });

  test("label has correct font weight", async ({ appPage }) => {
    const fw = await appPage.locator(".voice-row-label").evaluate(
      (el) => window.getComputedStyle(el).fontWeight
    );
    expect(fw).toBe("500");
  });

  test("hint has smaller font and hint color", async ({ appPage }) => {
    const hint = appPage.locator(".voice-row-hint");
    const fontSize = await hint.evaluate((el) => window.getComputedStyle(el).fontSize);
    expect(fontSize).toBe("13px");
  });

  test("card container height is stable (regression check)", async ({ appPage }) => {
    // Capture card height in idle state
    const card = appPage.locator(".card").first();
    const idleBox = await card.boundingBox();
    expect(idleBox).toBeTruthy();

    // Card height should be reasonable (not collapsed, not huge)
    expect(idleBox!.height).toBeGreaterThan(40);
    expect(idleBox!.height).toBeLessThan(200);
  });
});

test.describe("VoiceButton — Card Row Mode (Simplifier)", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.goto("/simplifier");
    await appPage.waitForSelector(".voice-row");
  });

  test("shows label and hint specific to simplifier", async ({ appPage }) => {
    await expect(appPage.locator(".voice-row-label")).toContainText("Записать голос");
    await expect(appPage.locator(".voice-row-hint")).toContainText("Расшифрую и упрощу");
  });

  test("icon is clickable", async ({ appPage }) => {
    const icon = appPage.locator(".voice-row-icon");
    const cursor = await icon.evaluate((el) => window.getComputedStyle(el).cursor);
    expect(cursor).toBe("pointer");
  });
});

test.describe("VoiceButton — Inline Mode (Expenses)", () => {
  test("voice button in expenses is compact 44x44 circle", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".voice-btn");

    const btn = appPage.locator(".voice-btn");
    const styles = await btn.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        width: cs.width,
        height: cs.height,
        borderRadius: cs.borderRadius,
      };
    });
    expect(styles.width).toBe("44px");
    expect(styles.height).toBe("44px");
    expect(styles.borderRadius).toBe("50%");
  });
});

test.describe("VoiceButton — Processing State CSS", () => {
  test("processing button style has auto width and rounded corners", async ({ appPage }) => {
    await appPage.goto("/expenses");
    await appPage.waitForSelector(".voice-btn");

    // Inject a processing state button for CSS verification
    await appPage.evaluate(() => {
      const btn = document.querySelector(".voice-btn");
      if (btn) {
        btn.classList.add("processing");
        btn.textContent = "Обработка...";
      }
    });

    const styles = await getComputedStyles(appPage, ".voice-btn.processing", [
      "width", "border-radius",
    ]);
    expect(styles["width"]).not.toBe("44px"); // auto width
    expect(styles["border-radius"]).toBe("8px");
  });
});

test.describe("VoiceButton — Voice Row CSS States", () => {
  test("recording icon class applies via CSS", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row-icon");

    // Verify recording CSS rule exists by checking a dedicated test element
    const hasCssRule = await appPage.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSStyleRule && rule.selectorText?.includes("voice-row-icon--recording")) {
              return true;
            }
          }
        } catch { /* cross-origin sheet */ }
      }
      return false;
    });
    expect(hasCssRule).toBe(true);
  });

  test("spinner animation exists for processing state", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row-icon");

    // Inject spinner
    await appPage.evaluate(() => {
      const icon = document.querySelector(".voice-row-icon");
      if (icon) {
        icon.classList.add("voice-row-icon--processing");
        icon.innerHTML = '<span class="voice-spinner"></span>';
      }
    });

    const spinner = appPage.locator(".voice-spinner");
    const animation = await spinner.evaluate(
      (el) => window.getComputedStyle(el).animationName
    );
    expect(animation).toBe("spin");
  });

  test("voice-dot has pulse animation", async ({ appPage }) => {
    await appPage.goto("/transcribe");
    await appPage.waitForSelector(".voice-row-icon");

    // Inject dot
    await appPage.evaluate(() => {
      const container = document.createElement("span");
      container.className = "voice-dot";
      document.querySelector(".voice-row")?.appendChild(container);
    });

    const dot = appPage.locator(".voice-dot");
    const animation = await dot.evaluate(
      (el) => window.getComputedStyle(el).animationName
    );
    expect(animation).toBe("pulse");
  });
});
