import { Notice } from "obsidian";
import type MyWorkoutCompanionPlugin from "./main";

export class CatalogAndTemplatesEditor {
  private plugin: MyWorkoutCompanionPlugin;
  private hostEl: HTMLElement;
  private newExName = "";
  private newExField: "повторы" | "секунды" = "повторы";

  constructor(plugin: MyWorkoutCompanionPlugin, hostEl: HTMLElement) {
    this.plugin = plugin;
    this.hostEl = hostEl;
  }

  render(): void {
    this.hostEl.empty();

    this.hostEl.createEl("h3", { text: "Каталог упражнений (program.json)" });
    const catCard = this.hostEl.createDiv("my-wc-set-card");
    catCard.createDiv({
      cls: "my-wc-set-subtitle",
      text: "Отмеченные галочкой упражнения показываются как быстрые кнопки добавления прямо в окне тренировки. Все остальные также доступны в выпадающем списке.",
    });

    const addRow = catCard.createDiv("my-wc-set-ex-row");
    const nameInp = addRow.createEl("input", {
      cls: "my-wc-set-target",
      attr: {
        type: "text",
        placeholder: "Название нового упражнения…",
        value: this.newExName,
      },
    });
    nameInp.oninput = () => {
      this.newExName = nameInp.value;
    };

    const kindSel = addRow.createEl("select", { cls: "dropdown" });
    kindSel.createEl("option", {
      value: "повторы",
      text: "Повторения (повт.)",
    });
    const secOpt = kindSel.createEl("option", {
      value: "секунды",
      text: "Время (секунды, с)",
    });
    if (this.newExField === "секунды") secOpt.selected = true;
    kindSel.onchange = () => {
      this.newExField = kindSel.value === "секунды" ? "секунды" : "повторы";
    };

    const addBtn = addRow.createEl("button", {
      cls: "mod-cta my-wc-btn",
      text: "＋ Добавить упражнение",
      attr: { type: "button" },
    });
    addBtn.onclick = () => {
      const clean = this.newExName.trim();
      if (!clean) {
        new Notice("Введи название упражнения.");
        return;
      }
      this.plugin.programStore.addCustomExercise(clean, this.newExField);
      this.newExName = "";
      new Notice(`Добавлено упражнение: «${clean}»`);
      this.render();
    };

    const catList = catCard.createDiv("my-wc-set-ex-list");
    for (const item of this.plugin.programStore.getCatalog()) {
      const row = catList.createDiv("my-wc-set-ex-row");

      const quickChk = row.createEl("input", {
        attr: {
          type: "checkbox",
          title: "Показывать как быструю кнопку в конструкторе тренировки",
        },
      });
      quickChk.checked = Boolean(item.isQuickBase || item.isCustom);
      quickChk.onchange = () => {
        this.plugin.programStore.toggleQuickButton(item.name, quickChk.checked);
      };

      row.createSpan({
        cls: "my-wc-set-cat-name",
        text: `${item.name} · ${item.field} (${item.unit})${item.isCustom ? " · своё" : ""}`,
      });

      const delBtn = row.createEl("button", {
        cls: "my-wc-btn",
        text: "✕",
        attr: { type: "button", title: "Убрать из каталога" },
      });
      delBtn.onclick = () => {
        this.plugin.programStore.removeExerciseFromCatalog(item.name);
        this.render();
      };
    }

    const actions = catCard.createDiv("my-wc-set-actions");
    const resetBtn = actions.createEl("button", {
      cls: "my-wc-btn",
      text: "↺ Восстановить базовый каталог",
      attr: { type: "button" },
    });
    resetBtn.onclick = () => {
      this.plugin.programStore.resetCatalogToDefaults();
      new Notice("Базовый каталог упражнений восстановлен.");
      this.render();
    };
  }
}
