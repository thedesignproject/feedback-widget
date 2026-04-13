import { jsxs as c, jsx as n, Fragment as K } from "react/jsx-runtime";
import { useState as f, useRef as R, useEffect as y, useCallback as V } from "react";
const P = /[^a-zA-Z0-9_-]/;
function q(a) {
  return a.length > 0 && !P.test(a);
}
function G(a) {
  if (a.id && !P.test(a.id)) return `#${a.id}`;
  const o = [];
  let s = a;
  for (; s && s !== document.body; ) {
    let l = s.tagName.toLowerCase();
    if (s.className && typeof s.className == "string") {
      const d = s.className.trim().split(/\s+/).filter(q).slice(0, 2);
      d.length && (l += "." + d.join("."));
    }
    const u = s.parentElement;
    if (u) {
      const d = Array.from(u.children).filter(
        (g) => g.tagName === s.tagName
      );
      if (d.length > 1) {
        const g = d.indexOf(s) + 1;
        l += `:nth-of-type(${g})`;
      }
    }
    o.unshift(l), s = u;
  }
  return o.join(" > ");
}
const j = "https://feedback-widget-sigma.vercel.app/api", p = "data-fw";
function J(a) {
  const o = Math.floor((Date.now() - new Date(a).getTime()) / 1e3);
  if (o < 5) return "just now";
  if (o < 60) return `${o}s ago`;
  const s = Math.floor(o / 60);
  if (s < 60) return `${s} min ago`;
  const l = Math.floor(s / 60);
  return l < 24 ? `${l}h ago` : `${Math.floor(l / 24)}d ago`;
}
function ee({ projectId: a }) {
  const [o, s] = f("idle"), [l, u] = f(null), [d, g] = f(""), [w, x] = f(!1), [O, $] = f(!1), [z, C] = f(!1), [L, k] = f(null), [I, T] = f(!1), [v, E] = f([]), [h, b] = f(!1), [D, F] = f(/* @__PURE__ */ new Set()), [N, A] = f(!1), M = R(null), Y = R(null);
  y(() => {
    async function e() {
      try {
        const t = await fetch(`${j}/comments?projectId=${encodeURIComponent(a)}`);
        if (!t.ok) return;
        const r = await t.json();
        Array.isArray(r) && E(r);
      } catch {
      }
    }
    e();
  }, [a]), y(() => {
    if (o !== "selecting") return;
    const e = document.body.style.cursor;
    return document.body.style.cursor = "crosshair", () => {
      document.body.style.cursor = e;
    };
  }, [o]), y(() => {
    if (o !== "selecting") {
      k(null);
      return;
    }
    function e(t) {
      var i;
      const r = t.target;
      r && !((i = r.closest) != null && i.call(r, `[${p}]`)) ? k(r) : k(null);
    }
    return window.addEventListener("mousemove", e), () => window.removeEventListener("mousemove", e);
  }, [o]), y(() => {
    if (!L) return;
    const e = L, t = e.style.outline, r = e.style.outlineOffset;
    return e.style.outline = "2px solid rgba(59, 130, 246, 0.6)", e.style.outlineOffset = "2px", () => {
      e.style.outline = t, e.style.outlineOffset = r;
    };
  }, [L]), y(() => {
    if (o !== "selecting") return;
    function e(t) {
      var i;
      const r = t.target;
      (i = r.closest) != null && i.call(r, `[${p}]`) || (t.preventDefault(), t.stopPropagation(), u({
        selector: G(r),
        xPercent: t.clientX / window.innerWidth * 100,
        yPercent: t.clientY / window.innerHeight * 100,
        url: window.location.href,
        clickX: t.clientX,
        clickY: t.clientY
      }), s("commenting"));
    }
    return window.addEventListener("click", e, !0), () => window.removeEventListener("click", e, !0);
  }, [o]), y(() => {
    o === "commenting" && M.current && M.current.focus();
  }, [o]);
  const W = V(async () => {
    if (!d.trim() || !l) return;
    const e = d.trim(), t = { ...l };
    x(!0);
    const r = {
      id: crypto.randomUUID(),
      project_id: a,
      url: t.url,
      x: t.xPercent,
      y: t.yPercent,
      element: t.selector,
      comment: e,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    fetch(`${j}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: a,
        url: t.url,
        x: t.xPercent,
        y: t.yPercent,
        element: t.selector,
        comment: e
      })
    }).then((i) => {
      i.ok ? console.log("[FeedbackWidget] Comment saved to API") : console.warn("[FeedbackWidget] API returned", i.status);
    }).catch((i) => console.warn("[FeedbackWidget] API error:", i)), E((i) => [r, ...i]), F((i) => new Set(i).add(r.id)), A(!0), setTimeout(() => A(!1), 400), setTimeout(() => {
      F((i) => {
        const m = new Set(i);
        return m.delete(r.id), m;
      });
    }, 2e3), u(null), g(""), x(!1), k(null), s("selecting"), C(!0), setTimeout(() => {
      C(!1), b(!0);
    }, 800);
  }, [d, l, a]);
  y(() => {
    function e(t) {
      t.key === "Escape" && (o === "commenting" ? (u(null), g(""), x(!1), s("selecting")) : h && b(!1)), t.key === "Enter" && (t.metaKey || t.ctrlKey) && o === "commenting" && W();
    }
    if (o !== "idle" || h)
      return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
  }, [o, W, h]);
  function B() {
    s("idle"), u(null), g(""), x(!1), $(!1), C(!1), k(null);
  }
  function H() {
    s("selecting");
  }
  function X() {
    o !== "idle" ? B() : v.length > 0 ? b((e) => !e) : s("selecting");
  }
  function _(e) {
    try {
      const t = document.querySelector(e);
      if (!t) return;
      t.scrollIntoView({ behavior: "smooth", block: "center" }), t.classList.add("fw-highlight"), setTimeout(() => t.classList.remove("fw-highlight"), 1400);
    } catch {
    }
  }
  const U = () => {
    if (!l) return { display: "none" };
    const e = 12, t = 300, r = 180;
    let i = l.clickX + e, m = l.clickY + e;
    return i + t > window.innerWidth && (i = l.clickX - t - e), m + r > window.innerHeight && (m = l.clickY - r - e), i < e && (i = e), m < e && (m = e), {
      position: "fixed",
      left: i,
      top: m,
      zIndex: 2147483646
    };
  }, S = v.length;
  return /* @__PURE__ */ c("div", { [p]: "", children: [
    o === "selecting" && /* @__PURE__ */ n(
      "div",
      {
        [p]: "",
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 2147483644,
          pointerEvents: "none",
          background: "transparent"
        }
      }
    ),
    o === "commenting" && l && /* @__PURE__ */ c(K, { children: [
      /* @__PURE__ */ n(
        "div",
        {
          [p]: "",
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 2147483645,
            background: "rgba(0, 0, 0, 0.05)"
          },
          onClick: () => {
            u(null), g(""), x(!1), s("selecting");
          }
        }
      ),
      /* @__PURE__ */ c(
        "div",
        {
          ref: Y,
          [p]: "",
          style: {
            ...U(),
            width: 300,
            background: "#fff",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
            padding: 16,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          },
          children: [
            /* @__PURE__ */ n(
              "textarea",
              {
                ref: M,
                value: d,
                onChange: (e) => g(e.target.value),
                placeholder: "What would you change?",
                rows: 3,
                style: {
                  width: "100%",
                  border: "1px solid #e0e0e0",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.15s"
                },
                onFocus: (e) => e.target.style.borderColor = "#3b82f6",
                onBlur: (e) => e.target.style.borderColor = "#e0e0e0"
              }
            ),
            /* @__PURE__ */ n("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 10 }, children: /* @__PURE__ */ n(
              "button",
              {
                onClick: W,
                disabled: !d.trim() || w,
                style: {
                  padding: "6px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: !d.trim() || w ? "#a0a0a0" : "#111",
                  border: "none",
                  borderRadius: 6,
                  cursor: !d.trim() || w ? "default" : "pointer",
                  transition: "background 0.15s"
                },
                children: w ? "Sending…" : "Send →"
              }
            ) }),
            /* @__PURE__ */ n(
              "div",
              {
                style: {
                  marginTop: 8,
                  fontSize: 11,
                  color: "#999",
                  textAlign: "right"
                },
                children: "\\u2318+Enter to send \\u00b7 Esc to cancel"
              }
            )
          ]
        }
      )
    ] }),
    o === "commenting" && l && !O && /* @__PURE__ */ n(
      "div",
      {
        [p]: "",
        style: {
          position: "fixed",
          left: l.clickX - 6,
          top: l.clickY - 6,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#3b82f6",
          border: "2px solid #fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          zIndex: 2147483646,
          pointerEvents: "none"
        }
      }
    ),
    /* @__PURE__ */ c(
      "div",
      {
        [p]: "",
        style: {
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          zIndex: 9999,
          background: "#111",
          borderLeft: "1px solid #222",
          transform: h ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex",
          flexDirection: "column",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        children: [
          /* @__PURE__ */ c(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "16px 16px 12px",
                borderBottom: "1px solid #222"
              },
              children: [
                /* @__PURE__ */ c("svg", { width: "20", height: "20", viewBox: "0 0 32 32", fill: "none", children: [
                  /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "13", stroke: "#fff", strokeWidth: "1.5", fill: "none" }),
                  /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "6", fill: "#fff" }),
                  /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "3", fill: "#111" }),
                  /* @__PURE__ */ n("circle", { cx: "18.5", cy: "13.5", r: "1.2", fill: "#fff" })
                ] }),
                /* @__PURE__ */ n("span", { style: { color: "#fff", fontSize: 14, fontWeight: 600, flex: 1 }, children: "Feedback" }),
                /* @__PURE__ */ c("span", { style: { color: "#555", fontSize: 12 }, children: [
                  S,
                  " comment",
                  S !== 1 ? "s" : ""
                ] }),
                /* @__PURE__ */ n(
                  "button",
                  {
                    onClick: () => b(!1),
                    style: {
                      background: "none",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 4,
                      transition: "color 0.15s"
                    },
                    onMouseEnter: (e) => e.currentTarget.style.color = "#fff",
                    onMouseLeave: (e) => e.currentTarget.style.color = "#666",
                    children: /* @__PURE__ */ c("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", children: [
                      /* @__PURE__ */ n("line", { x1: "4", y1: "4", x2: "12", y2: "12", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
                      /* @__PURE__ */ n("line", { x1: "12", y1: "4", x2: "4", y2: "12", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" })
                    ] })
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ c(
            "div",
            {
              style: {
                flex: 1,
                overflowY: "auto",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8
              },
              children: [
                v.length === 0 && /* @__PURE__ */ n("div", { style: { color: "#444", fontSize: 13, textAlign: "center", marginTop: 40 }, children: "No comments yet" }),
                v.map((e, t) => {
                  const r = D.has(e.id);
                  return /* @__PURE__ */ c(
                    "div",
                    {
                      onClick: () => _(e.element),
                      style: {
                        background: r ? "#1e2a1e" : "#1a1a1a",
                        borderRadius: 8,
                        padding: 12,
                        borderLeft: "2px solid #3b82f6",
                        cursor: "pointer",
                        animation: h ? r ? "fw-slide-in-new 0.3s ease both" : `fw-slide-in 0.3s ease ${t * 0.08}s both` : "none",
                        transition: "background 0.15s"
                      },
                      onMouseEnter: (i) => {
                        r || (i.currentTarget.style.background = "#222");
                      },
                      onMouseLeave: (i) => {
                        i.currentTarget.style.background = r ? "#1e2a1e" : "#1a1a1a";
                      },
                      children: [
                        /* @__PURE__ */ n("div", { style: { color: "#fff", fontSize: 14, lineHeight: 1.4, marginBottom: 8 }, children: e.comment }),
                        /* @__PURE__ */ n(
                          "div",
                          {
                            style: {
                              fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace',
                              color: "#666",
                              fontSize: 11,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              marginBottom: 2
                            },
                            children: e.element
                          }
                        ),
                        /* @__PURE__ */ c(
                          "div",
                          {
                            style: {
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center"
                            },
                            children: [
                              /* @__PURE__ */ n(
                                "span",
                                {
                                  style: {
                                    color: "#666",
                                    fontSize: 11,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    maxWidth: "60%"
                                  },
                                  children: e.url.replace(/^https?:\/\//, "")
                                }
                              ),
                              /* @__PURE__ */ n("span", { style: { color: "#444", fontSize: 11, flexShrink: 0 }, children: J(e.created_at) })
                            ]
                          }
                        )
                      ]
                    },
                    e.id
                  );
                })
              ]
            }
          ),
          /* @__PURE__ */ n("div", { style: { padding: 12, borderTop: "1px solid #222" }, children: o !== "idle" ? /* @__PURE__ */ c(
            "button",
            {
              onClick: () => {
                B(), b(!1);
              },
              style: {
                width: "100%",
                padding: "10px 0",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: "#22c55e",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "background 0.15s"
              },
              onMouseEnter: (e) => e.currentTarget.style.background = "#16a34a",
              onMouseLeave: (e) => e.currentTarget.style.background = "#22c55e",
              children: [
                /* @__PURE__ */ n("svg", { width: "14", height: "14", viewBox: "0 0 28 28", fill: "none", children: /* @__PURE__ */ n(
                  "path",
                  {
                    d: "M5 14.5L11 20.5L23 8.5",
                    stroke: "#fff",
                    strokeWidth: "2.5",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  }
                ) }),
                "Done"
              ]
            }
          ) : /* @__PURE__ */ c(
            "button",
            {
              onClick: H,
              style: {
                width: "100%",
                padding: "10px 0",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: "#3b82f6",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "background 0.15s"
              },
              onMouseEnter: (e) => e.currentTarget.style.background = "#2563eb",
              onMouseLeave: (e) => e.currentTarget.style.background = "#3b82f6",
              children: [
                /* @__PURE__ */ c("svg", { width: "14", height: "14", viewBox: "0 0 32 32", fill: "none", children: [
                  /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "13", stroke: "#fff", strokeWidth: "2", fill: "none" }),
                  /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "6", fill: "#fff" }),
                  /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "3", fill: "#3b82f6" })
                ] }),
                "Leave feedback"
              ]
            }
          ) })
        ]
      }
    ),
    !h && /* @__PURE__ */ c(
      "div",
      {
        [p]: "",
        style: {
          position: "fixed",
          bottom: 24,
          right: h ? 344 : 24,
          zIndex: 2147483647,
          transition: "right 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
        },
        children: [
          /* @__PURE__ */ n(
            "button",
            {
              onClick: X,
              onMouseEnter: () => T(!0),
              onMouseLeave: () => T(!1),
              style: {
                width: 64,
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                border: "none",
                borderRadius: "50%",
                cursor: "pointer",
                background: o === "selecting" || o === "commenting" ? "#c0392b" : I ? "#222" : "#111",
                boxShadow: z ? "0 0 0 3px #22c55e, 0 4px 16px rgba(0,0,0,0.2)" : o === "selecting" || o === "commenting" ? "0 0 0 3px #3b82f6, 0 4px 16px rgba(0,0,0,0.2)" : "0 4px 16px rgba(0,0,0,0.2)",
                transition: "background 0.2s, box-shadow 0.2s, transform 0.15s",
                transform: I ? "scale(1.06)" : "scale(1)"
              },
              children: z ? /* @__PURE__ */ n("svg", { width: "28", height: "28", viewBox: "0 0 28 28", fill: "none", children: /* @__PURE__ */ n(
                "path",
                {
                  d: "M7 14.5L12 19.5L21 9.5",
                  stroke: "#22c55e",
                  strokeWidth: "2.5",
                  strokeLinecap: "round",
                  strokeLinejoin: "round"
                }
              ) }) : o === "selecting" || o === "commenting" ? /* @__PURE__ */ c("svg", { width: "28", height: "28", viewBox: "0 0 28 28", fill: "none", children: [
                /* @__PURE__ */ n("line", { x1: "9", y1: "9", x2: "19", y2: "19", stroke: "#fff", strokeWidth: "2.2", strokeLinecap: "round" }),
                /* @__PURE__ */ n("line", { x1: "19", y1: "9", x2: "9", y2: "19", stroke: "#fff", strokeWidth: "2.2", strokeLinecap: "round" })
              ] }) : /* @__PURE__ */ c("svg", { width: "32", height: "32", viewBox: "0 0 32 32", fill: "none", children: [
                /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "13", stroke: "#fff", strokeWidth: "1.5", fill: "none" }),
                /* @__PURE__ */ n(
                  "circle",
                  {
                    cx: "16",
                    cy: "16",
                    r: I ? 7 : 6,
                    fill: "#fff",
                    style: { transition: "r 0.2s" }
                  }
                ),
                /* @__PURE__ */ n("circle", { cx: "16", cy: "16", r: "3", fill: "#111" }),
                /* @__PURE__ */ n("circle", { cx: "18.5", cy: "13.5", r: "1.2", fill: "#fff" })
              ] })
            }
          ),
          S > 0 && /* @__PURE__ */ n(
            "button",
            {
              onClick: (e) => {
                e.stopPropagation(), b((t) => !t);
              },
              style: {
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 22,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 6px",
                background: "#3b82f6",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                border: "2px solid #111",
                borderRadius: 11,
                cursor: "pointer",
                animation: N ? "fw-badge-pop 0.4s ease" : "none",
                transition: "transform 0.15s"
              },
              children: S
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ n("style", { children: `
        @keyframes fw-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fw-badge-pop {
          0% { transform: scale(1); }
          30% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
        @keyframes fw-slide-in {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes fw-slide-in-new {
          0% { opacity: 0; transform: translateY(-12px); }
          50% { background: #1e3a1e; }
          100% { opacity: 1; transform: translateY(0); }
        }
        .fw-highlight {
          outline: 2px solid #3b82f6 !important;
          outline-offset: 2px !important;
          background-color: rgba(59, 130, 246, 0.15) !important;
          animation: fw-highlight-pulse 1.4s ease both !important;
        }
        @keyframes fw-highlight-pulse {
          0% { outline-color: transparent; background-color: transparent; }
          14% { outline-color: #3b82f6; background-color: rgba(59, 130, 246, 0.15); }
          71% { outline-color: #3b82f6; background-color: rgba(59, 130, 246, 0.15); }
          100% { outline-color: transparent; background-color: transparent; }
        }
      ` })
  ] });
}
export {
  ee as FeedbackWidget
};
