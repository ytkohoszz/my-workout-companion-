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

    // 1. Шаблоны тренировок
    this.hostEl.createEl("h3", { text: "Быстрые шаблоны тренировок" });
    const tplCard = this.hostEl.createDiv("my-wc-set-card");
    tplCard.createDiv({
      cls: "my-wc-set-subtitle",
      text: "Шаблоны — это необязательные заготовки для быстрого заполнения состава тренировки. Создавать новые шаблоны удобнее всего прямо в окне тренировки кнопкой «Сохранить как шаблон».",
    });

    const templates = this.plugin.programStore.getTemplates();
    if (templates.length === 0) {
      tplCard.createDiv({
        cls: "my-wc-sets-empty",
        text: "Сохранённых шаблонов пока нет.",
      });
    } else {
      const tplList = tplCard.createDiv("my-wc-set-ex-list");
      for (const tpl of templates) {
        const row = tplList.createDiv("my-wc-set-ex-row");
        const info = row.createDiv("my-wc-set-cat-name");
        info.createEl("strong", { text: tpl.name });
        const summary = tpl.exercises
          .map(
            (e) =>
              `${e.name} (${e.sets}×${e.target}${e.weight > 0 ? `, +${e.weight}кг` : ""})`
          )
          .join(" · ");
        info.createDiv({
          cls: "my-wc-subtitle",
          text: summary,
        });

        const delBtn = row.createEl("button", {
          cls: "my-wc-btn",
          text: "✕ Удалить",
          attr: { type: "button" },
        });
        delBtn.onclick = () => {
          this.plugin.programStore.deleteTemplate(tpl.id);
          this.render();
        };
      }
    }

    const tplActions = tplCard.createDiv("my-wc-set-actions");
    const resetTplsBtn = tplActions.createEl("button", {
      cls: "my-wc-btn",
      text: "↺ Восстановить базовые шаблоны",
      attr: { type: "button" },
    });
    resetTplsBtn.onclick = () => {
      this.plugin.programStore.resetTemplatesToDefaults();
      new Notice("Базовые шаблоны восстановлены.");
      this.render();
    };

    // 2. Каталог упражнений
    this.hostEl.createEl("h3", { text: "Каталог упражнений (program.json)" });
    const catCard = this.hostEl.createDiv("my-wc-set-card");
    catCard.createDiv({
      cls: "my-wc-set-subtitle",
      text: "Названия существующих упражнений защищены от переименования, чтобы не нарушать историю рекордов в прошлых заметках тренировок. Ты можешь в любой момент добавить своё упражнение.",
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
      text: "＋ Добавить в каталог",
      attr: { type: "button" },
    });
    addBtn.onclick = () => {
      const clean = this.newExName.trim();
      if (!clean) {
        new Notice("Введи название упражнения.");
        return;
      }
      if (this.plugin.programStore.findExercise(clean)) {
        new Notice("Такое упражнение уже есть в каталоге.");
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
      row.createSpan({
        cls: "my-wc-set-cat-name",
        text: `${item.name} · ${item.field} (${item.unit})${item.isCustom ? " · своё" : ""}`,
      });

      const delBtn = row.createEl("button", {
        cls: "my-wc-btn",
        text: "✕",
        attr: { type: "button", title: "Убрать из списка выбора" },
      });
      delBtn.onclick = () => {
        this.plugin.programStore.removeExerciseFromCatalog(item.name);
        this.render();
      };
    }
  }
}
