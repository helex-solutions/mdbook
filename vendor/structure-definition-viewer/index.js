//#region src/utils/object.util.ts
function e(e, n) {
	if (t(e) && t(n)) return n.split(".").reduce((e, t) => e?.[t], e);
}
function t(e) {
	return !n(e);
}
function n(e) {
	return e == null;
}
//#endregion
//#region src/utils/array.util.ts
function r(e) {
	let t = [];
	return e.forEach((e) => {
		e.forEach((n, r) => {
			if (!~t.indexOf(n)) {
				if (r > 0) {
					let i = t.indexOf(e[r - 1]);
					t.splice(i + 1, 0, n);
					return;
				}
				t.push(n);
			}
		});
	}), t;
}
//#endregion
//#region src/tree/util.ts
function i(e) {
	if (!n(e) && e.resourceType === "StructureDefinition") return a(e);
}
var a = (e) => {
	let n = o(e), r = n.filter((e) => t(e.snap)).map((e) => ({ snap: e.snap })), i = n.filter((e) => t(e.diff)).map((e) => ({ diff: e.diff }));
	return {
		hybrid: s(n, e.name),
		snap: s(r, e.name),
		diff: s(i, e.name)
	};
}, o = (e) => r([e.snapshot?.element.map((e) => e.path) ?? [], e.differential?.element.map((e) => e.path) ?? []]).map((t) => ({
	diff: e.differential?.element?.find((e) => e.path === t),
	snap: e.snapshot?.element?.find((e) => e.path === t)
})), s = (n, r) => {
	let i = (n, r) => {
		let i = e(n.diff, r), a = e(n.snap, r);
		if (t(a) && t(i) && a !== i) throw Error(`Different values for key ${r}`);
		return a ?? i;
	}, a = n.find((e) => i(e, "path") === r) ?? {
		diff: { path: r },
		snap: { path: r }
	};
	return n.filter((e) => i(e, "path") !== i(a, "path")).reduce((e, t) => {
		let n = i(t, "id").split(/\.|:/).slice(1);
		return {
			...e,
			...c(e, n, t)
		};
	}, {
		...a,
		children: {}
	});
}, c = (e, n, r) => {
	e.children ??= {};
	let [i, ...a] = n, o = (n) => t(e.children[n]) ? e.children[n] : e.children[n] = {
		...r,
		children: {}
	};
	return n.length === 1 && o(i), n.length > 1 && c(o(i), a, r), e;
}, l = class e {
	static process(e, t) {
		if (e?.trim().startsWith("{")) return this.processObj(JSON.parse(e), t);
	}
	static processObj(t, r) {
		let a = i(t);
		if (n(a)) return;
		let o = a[r];
		if (o) return e.composeTree(t.name, o);
	}
	static composeTree(e, t) {
		t.children ??= {};
		let n = {
			key: e,
			data: {
				diff: this.transformer(e, t.diff),
				snap: this.transformer(e, t.snap)
			},
			children: Object.keys(t.children).map((e) => this.composeTree(e, t.children[e])),
			selectable: Object.keys(t.children)?.length > 0,
			open: Object.keys(t.children).length > 0
		};
		return n.children?.forEach((e) => e.parent = n), n;
	}
	static transformer = (e, r) => {
		if (!n(r)) return {
			title: e,
			types: r.type?.map((e) => ({
				code: e.code,
				targetProfiles: e.targetProfile
			})),
			short: r.short,
			definition: r.definition === r.short ? void 0 : r.definition,
			binding: r.binding ? {
				valueSet: r.binding.valueSet,
				strength: r.binding.strength
			} : void 0,
			min: t(r.min) ? String(r.min) : void 0,
			max: r.max,
			flags: {
				summary: t(r.isSummary) ? r.isSummary : void 0,
				modifier: t(r.isModifier) ? r.isModifier : void 0,
				constraint: t(r.constraint) ? !!r.constraint?.length : void 0
			}
		};
	};
}, u = class i {
	node;
	constructor(e, t, n, r = "diff", i = !1, a = [
		"flags",
		"cardinality",
		"types",
		"description"
	], o, s, c = /* @__PURE__ */ new Map()) {
		this.DOCUMENT = e, this.CONTAINER = t, this.data = n, this.mode = r, this.inline = i, this.columns = a, this.resolveUrl = o, this.linkBase = s, this.resolveCache = c;
	}
	static build(e, t) {
		return t.mode ??= "diff", t.inline ??= !1, t.columns ??= [
			"flags",
			"cardinality",
			"types",
			"description"
		], new i(t.document, t.container, e, t.mode, t.inline, t.columns, t.resolveUrl, t.linkBase, t.resolveCache);
	}
	render() {
		return this.node = l.process(this.data, this.mode), this._render();
	}
	_render() {
		if (n(this.CONTAINER)) return;
		let e = this.node;
		if (e === void 0) {
			this.CONTAINER.innerHTML = "error";
			return;
		}
		let t = this.DOCUMENT.createElement("div");
		t.innerHTML = `
      <div style="display: flex; justify-content: flex-end" class="button-group">
        <button class="button ${this.mode === "diff" ? "active" : ""}" data-mode="diff">diff</button>
        <button class="button ${this.mode === "hybrid" ? "active" : ""}" data-mode="hybrid">hybrid</button>
        <button class="button ${this.mode === "snap" ? "active" : ""}" data-mode="snap">snap</button>
      </div>
      <br>

      <div style="overflow: auto;">
        ${this.createView(e)}
      </div>
    `, this.CONTAINER.replaceChildren(t), t.querySelectorAll("[data-mode]").forEach((e) => {
			e.addEventListener("click", () => {
				this.mode = e.getAttribute("data-mode"), this.render();
			});
		}), t.querySelectorAll(".m-tree-toggle").forEach((t) => {
			t.addEventListener("click", ({ target: t }) => {
				let r = t.closest("[data-key]");
				if (n(r)) return;
				let i = (e) => [e, ...e.children?.flatMap((e) => i(e)) ?? []], a = r.getAttribute("data-key"), o = i(e).find((e) => e.key === a);
				o.open = !o.open, this._render();
			});
		}), this.resolveUrl && this.rewriteCanonicalLinks(t);
	}
	rewriteCanonicalLinks(e) {
		let t = Array.from(e.querySelectorAll("a[data-sdv-canonical]"));
		if (t.length === 0) return;
		let n = this.deriveLinkBase(), r = /* @__PURE__ */ new Map();
		t.forEach((e) => {
			let t = e.getAttribute("data-sdv-canonical"), i = e.getAttribute("data-sdv-canonical-type");
			if (!t || !i) return;
			let a = `${i}|${t}`;
			if (this.resolveCache.has(a)) {
				let t = this.resolveCache.get(a);
				t && e.setAttribute("href", t);
				return;
			}
			let o = r.get(a);
			o || (o = this.fetchResolve(i, t, n), r.set(a, o)), o.then((t) => {
				this.resolveCache.set(a, t), t && e.setAttribute("href", t);
			});
		});
	}
	async fetchResolve(e, t, n) {
		try {
			let r = new URL(this.resolveUrl, window.location.href);
			r.searchParams.set("resourceType", e), r.searchParams.set("url", t);
			let i = await fetch(r.toString(), {
				method: "GET",
				headers: { Accept: "application/json" },
				credentials: "same-origin"
			});
			if (!i.ok) return null;
			let a = await i.json();
			return !a?.resolved || !a?.resourceType || !a?.id ? null : `${f(n)}/${encodeURIComponent(a.resourceType)}/${encodeURIComponent(a.id)}`;
		} catch {
			return null;
		}
	}
	deriveLinkBase() {
		if (this.linkBase) return this.linkBase;
		let e = this.resolveUrl;
		return e.endsWith("/_resolve") ? e.substring(0, e.length - 9) : e.endsWith("/_resolve/") ? e.substring(0, e.length - 10) : e;
	}
	createView(e) {
		return `
      <table style="border-collapse: collapse; width: 100%;">
        ${this.createRow(e)}
      </table>
    `;
	}
	createRow(n, a = 0) {
		let { data: o } = n, s = (n) => {
			let r = e(o.snap, n), i = e(o.diff, n);
			return {
				val: {
					diff: i,
					snap: r,
					hybrid: i ?? r
				}[this.mode],
				src: t(i) ? "diff" : "snap"
			};
		}, c = (e, n) => t(e.val) ? `<span style="opacity: ${this.mode === "hybrid" && e.src === "snap" ? .3 : 1}">${n?.(e.val) ?? e.val}</span>` : "";
		return `
      <tr
        class="${[
			"m-tree-row",
			"m-tree-row--show-line",
			i.calcNextSibling(n) ? "" : "m-tree-row--last-row",
			n.children?.length ? "" : "m-tree-row--leaf"
		].join(" ")}"
        style="font-weight: ${n.children?.length ? "bold" : "initial"}"
      >
        <td class="m-tree-profile-wrapper" >
          <div>
            <!-- indents -->
            ${this._indents(n)}
            <!-- toggle -->
            ${this._toggle(n)}
            <!-- title -->
            ${c(s("title"))}
          </div>
        </td>
        
        ${`
        <!-- Constraints -->
        ${this.columns.includes("flags") ? `<td style="vertical-align: top">
          ${Object.entries({
			modifier: "?!",
			summary: "Σ",
			constraint: "<code style=\"padding-left: 3px; padding-right: 3px; border: 1px maroon solid; font-weight: bold; color: #301212; background-color: #fdf4f4;\">C</code>"
		}).map(([e, t]) => c(s(`flags.${e}`), (e) => e ? t : "")).join(" ")}
        </td>` : ""}
        
        <!-- Cardinality -->
        ${this.columns.includes("cardinality") ? `<td style="vertical-align: top">
          ${c(s("min"))}..${c(s("max"))}
        </td>` : ""}
        
         <!-- Types -->
        ${this.columns.includes("types") ? `<td style="vertical-align: top">
          ${(() => {
			let e = o.snap?.types?.map((e) => ({
				type: e,
				src: "snap"
			})) ?? [], t = o.diff?.types?.map((e) => ({
				type: e,
				src: "diff"
			})) ?? [];
			return r([e.map((e) => e.type.code), t.map((e) => e.type.code)]).map((n) => {
				let r = e.find((e) => e.type.code === n), i = t.find((e) => e.type.code === n), a = i || r, o = c({
					val: a?.type.code,
					src: a?.src
				}), s = i?.type.targetProfiles ?? [], l = r?.type.targetProfiles?.filter((e) => !s.includes(e)) ?? [], u = [...s.map((e) => ({
					el: c({
						val: e,
						src: "diff"
					}, (e) => e.slice(e.lastIndexOf("/") + 1)),
					url: e
				})), ...l.map((e) => ({
					el: c({
						val: e,
						src: "snap"
					}, (e) => e.slice(e.lastIndexOf("/") + 1)),
					url: e
				}))];
				return [`${o}`, u.length ? `(${u.map((e) => `<a href="${e.url}" data-sdv-canonical="${d(e.url)}" data-sdv-canonical-type="StructureDefinition">${e.el}</a>`).join(", ")})` : ""].filter(Boolean).join("");
			}).join("<br>");
		})()}
        </td>` : ""}
        
        <!-- Description -->
        ${this.columns.includes("description") ? `<td style="vertical-align: top">
          ${c(s("short"), (e) => e ? `<div>${e}</div>` : "")}
          ${c(s("definition"), (e) => e ? `<i style="color: var(--color-text-secondary)">${e}</i>` : "")}
          ${c(s("binding"), (e) => e?.valueSet ? `<div style="color: var(--color-text-secondary)">Binding: <a href="${e.valueSet}" data-sdv-canonical="${d(e.valueSet)}" data-sdv-canonical-type="ValueSet">${e.valueSet.slice(e.valueSet.lastIndexOf("/") + 1)}</a> (${e?.strength})</div>` : "")}
        </td>` : ""}
      `}
      </tr>
  
      ${n.open ? n.children?.map((e) => this.createRow(e, a + 1)).join("") : ""}
    `;
	}
	_indents(e) {
		let t = "<span class=\"m-tree-indent-unit m-tree-indent--vertical-line m-tree-indent--horizontal-line\"></span>", n = [];
		if (String(this.inline) === "true") {
			let r = i.calcIndents(e).map((e) => `<span class="m-tree-indent-unit ${e ? "m-tree-indent--vertical-line" : ""}"></span>`);
			e.selectable || r.push(t), n = r.slice(1);
		} else {
			let r = i.calcIndents(e).map((e) => `<span class="m-tree-indent-unit ${e ? "m-tree-indent--vertical-line" : ""}"></span>`);
			e.parent && r.push(t), n = r.slice(1);
		}
		return [
			`<span class="m-tree-indent ${this.inline ? "m-tree-indent--inline" : ""}">`,
			n.join("\n"),
			"</span>"
		].join("\n");
	}
	_toggle(e) {
		return e.children?.length ? `
      <span class="m-tree-toggle" data-key="${e.key}">
        <i>
          <svg viewBox="64 64 896 896" focusable="false" fill="currentColor" width="1em" height="1em" data-icon="minus-square" aria-hidden="true">
            ${{
			open: "<path d=\"M328 544h368c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H328c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8z\"></path>",
			close: "<path d=\"M328 544h152v152c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V544h152c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H544V328c0-4.4-3.6-8-8-8h-48c-4.4 0-8 3.6-8 8v152H328c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8z\"></path>"
		}[e.open ? "open" : "close"]}
            <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zm-40 728H184V184h656v656z"></path>
          </svg>
        </i>
      </span>
    ` : "";
	}
	static calcIndents(e) {
		let t = [], n = e.parent;
		for (; n;) i.calcNextSibling(n) ? t.unshift(!0) : t.unshift(!1), n = n.parent;
		return t;
	}
	static calcNextSibling(e) {
		let t = e.parent?.children ?? [], n = t.findIndex((t) => t.key === e.key);
		return n === -1 ? void 0 : t[n + 1];
	}
};
function d(e) {
	return String(e).replace(/[&"<>]/g, (e) => {
		switch (e) {
			case "&": return "&amp;";
			case "\"": return "&quot;";
			case "<": return "&lt;";
			case ">": return "&gt;";
			default: return e;
		}
	});
}
function f(e) {
	return e.endsWith("/") ? e.substring(0, e.length - 1) : e;
}
//#endregion
//#region src/tree/component.ts
var p = "\n      :host {\n          --color-primary: #d97706;\n          --color-text: #1f1f1f;\n          --color-text-secondary: #00000073;\n          --color-borders: #d2d3d8;\n          --border-radius-component: 6px;\n      }\n\n\n      .m-tree-row {\n          text-align: left;\n          vertical-align: middle;\n          text-overflow: ellipsis;\n      }\n\n      .m-tree-row:nth-child(odd) {\n          background-color: #F7F7F7;\n      }\n\n\n      /* Profile wrapper */\n      .m-tree-profile-wrapper {\n          height: 0;\n      }\n\n      .m-tree-profile-wrapper > * {\n          display: flex;\n          height: 100%;\n      }\n\n\n      /* Indentation */\n\n      .m-tree-indent {\n          align-self: stretch;\n          white-space: nowrap;\n          user-select: none;\n          display: flex;\n      }\n\n      .m-tree-indent-unit {\n          display: inline-block;\n          width: 1.7142857142857rem;\n          height: 100%;\n      }\n\n\n      /* Toggle */\n\n      .m-tree-toggle {\n          position: relative;\n          width: 1.7142857142857rem;\n          display: flex;\n          align-items: center;\n          justify-content: center;\n      }\n\n      .m-tree-toggle > i {\n          display: flex;\n      }\n\n\n      /* Vertical Line */\n\n      .m-tree-row--show-line .m-tree-indent--vertical-line {\n          position: relative;\n          z-index: 1;\n      }\n\n      .m-tree-row--show-line .m-tree-indent--vertical-line::before {\n          position: absolute;\n          top: -1px;\n          left: 0.85714285714286rem;\n          bottom: -1px;\n          margin-left: -1px;\n          border-right: 1px solid var(--color-borders);\n          content: ' ';\n      }\n\n      .m-tree-row--show-line.m-tree-row--last-row .m-tree-indent:not(.m-tree-indent--inline) .m-tree-indent--vertical-line:last-of-type::before,\n      .m-tree-row--show-line.m-tree-row--last-row.m-tree-row--leaf .m-tree-indent--vertical-line:last-of-type::before {\n          height: 12.7px;\n      }\n\n\n      /* Horizontal Line */\n\n      .m-tree-row--show-line .m-tree-indent--horizontal-line::after {\n          position: absolute;\n          content: ' ';\n          height: 10.7px;\n          width: 0.71428571428571rem;\n          left: 0.85714285714286rem;\n          border-bottom: 1px solid var(--color-borders);\n      }\n      \n      .button {\n        appearance: none;\n        background-color: #FAFBFC;\n        border: 1px solid rgba(27, 31, 35, 0.15);\n        border-radius: var(--border-radius-component);\n        box-shadow: rgba(27, 31, 35, 0.04) 0 1px 0, rgba(255, 255, 255, 0.25) 0 1px 0 inset;\n        box-sizing: border-box;\n        color: #24292E;\n        cursor: pointer;\n        display: inline-block;\n        font-size: 14px;\n        font-weight: 500;\n        line-height: 20px;\n        list-style: none;\n        padding: 2px 16px;\n        position: relative;\n        transition: background-color 0.2s cubic-bezier(0.3, 0, 0.5, 1);\n        user-select: none;\n        -webkit-user-select: none;\n        touch-action: manipulation;\n        vertical-align: middle;\n        white-space: nowrap;\n        word-wrap: break-word;\n    }\n\n\n    /* Links */\n    \n    a {\n      color: var(--color-primary);\n    }\n\n\n    /* Buttons */\n    \n    .button.active {\n      color: white;\n      background-color: var(--color-primary);\n      box-shadow: var(--color-primary) 0px 1px 0px, rgba(255, 255, 255, 0.25) 0px 1px 0px inset;\n    }\n\n    .button-group .button {\n      border-radius: 0\n    }\n    \n    .button-group .button:first-child {\n      border-top-left-radius: var(--border-radius-component);\n      border-bottom-left-radius: var(--border-radius-component);\n    }\n    \n    .button-group .button:last-child {\n      border-top-right-radius: var(--border-radius-component);\n      border-bottom-right-radius: var(--border-radius-component);\n    }\n    \n    .button-group .button:not(:last-child) {\n      border-right: none;\n    }\n  ", m = class extends HTMLElement {
	mode = "diff";
	data;
	inline;
	columns = [
		"flags",
		"cardinality",
		"types",
		"description"
	];
	resolveUrl;
	linkBase;
	resolveCache = /* @__PURE__ */ new Map();
	static get observedAttributes() {
		return [
			"mode",
			"data",
			"inline",
			"columns",
			"resolve-url",
			"link-base"
		];
	}
	attributeChangedCallback(e, t, n) {
		if (t === n) return;
		let r = e.replace(/-([a-z])/g, (e, t) => t.toUpperCase());
		this[r] = n, Promise.resolve().then(() => this.render());
	}
	connectedCallback() {
		let e = this.attachShadow({ mode: "open" }), t = new CSSStyleSheet();
		t.replaceSync(p), e.adoptedStyleSheets.push(t), this.render();
	}
	render() {
		let e = decodeURIComponent(this.data ?? "");
		u.build(e, {
			document,
			container: this.shadowRoot,
			mode: this.mode,
			inline: this.inline,
			columns: this.columns,
			resolveUrl: this.resolveUrl,
			linkBase: this.linkBase,
			resolveCache: this.resolveCache
		}).render();
	}
};
//#endregion
//#region src/index.ts
function h(e = "sd-view") {
	!customElements.get(e) && customElements.define(e, m);
}
function g(e) {
	let t = {
		container: e?.container ?? document.body,
		startOnLoad: e?.startOnLoad ?? !0,
		querySelector: e?.querySelector ?? "pre.language-structure-definition"
	};
	h("sd-view"), t.startOnLoad && document.readyState !== "complete" ? window.addEventListener("load", () => {
		_(Array.from(document.querySelectorAll(t.querySelector)));
	}) : _(Array.from(document.querySelectorAll(t.querySelector)));
}
function _(e) {
	e.forEach((e) => {
		e.outerHTML = `<sd-view data="${encodeURIComponent(e.textContent.trim())}"></sd-view>`;
	});
}
//#endregion
export { m as HelloWorld, u as TemplateBuilder, g as initialize, h as initializeWebComponent };
