/** Plugin stylesheet, injected once while the client plugin is active. */
export const STYLE_ID = 'dsh-artifacts-style'

const label1 = 'var(--dsw-alias-label-primary, #1d2129)'
const label2 = 'var(--dsw-alias-label-secondary, #4e5561)'
const label3 = 'var(--dsw-alias-label-tertiary, #868c96)'
const border = 'var(--dsw-alias-border-l2, rgba(0,0,0,.1))'
const borderSoft = 'var(--dsw-alias-border-l3, rgba(0,0,0,.06))'
const hover = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))'
const layer = 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.02))'
const base = 'var(--dsw-alias-bg-base, #fff)'
const error = 'var(--dsw-alias-state-error-primary, #d92d20)'
const accent = 'var(--dsw-alias-state-business-primary, #4d6bfe)'
const radius = 'var(--dsw-radius-lg, 12px)'
const radiusSm = 'var(--dsw-radius-sm, 6px)'
const fontSm = 'var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif)'
const fontXs = 'var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif)'

export const CSS = `
.dsha-card{display:flex;align-items:center;gap:12px;width:100%;max-width:520px;box-sizing:border-box;margin:4px 0;padding:10px 12px;border:1px solid ${border};border-radius:${radius};background:${layer};color:${label1};text-align:left;cursor:pointer;font:${fontSm};transition:background .12s,border-color .12s}
.dsha-card:hover{background:${hover};border-color:${border}}
.dsha-card:focus-visible{outline:2px solid var(--dsw-focus-ring-color, ${accent});outline-offset:2px}
.dsha-card[data-state="running"],.dsha-card[data-state="preparing"]{cursor:default}
.dsha-card[data-state="error"]{cursor:default;border-color:color-mix(in srgb, ${error} 35%, transparent)}
.dsha-glyph{flex:none;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;background:${base};border:1px solid ${borderSoft};color:${label2}}
.dsha-card[data-state="error"] .dsha-glyph{color:${error}}
.dsha-card-body{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;gap:1px}
.dsha-card-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsha-card-sub{font:${fontXs};color:${label3};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsha-card-sub[data-error]{color:${error};white-space:normal}
.dsha-card-action{flex:none;font:${fontXs};color:${label2};padding:4px 8px;border-radius:${radiusSm};border:1px solid ${borderSoft};background:${base}}
.dsha-card:hover .dsha-card-action{color:${label1}}
.dsha-tail{display:flex;flex-direction:column;gap:6px;margin:6px 0 2px}
.dsha-tail .dsha-card{margin:0}
.dsha-spin{animation:dsha-spin 1s linear infinite}
@keyframes dsha-spin{to{transform:rotate(360deg)}}

.dsha-tab{display:flex;flex-direction:column;height:100%;min-height:0;background:${base};color:${label1}}
.dsha-bar{flex:none;display:flex;align-items:center;gap:4px;height:40px;padding:0 8px;box-sizing:border-box;border-bottom:1px solid ${borderSoft};font:${fontSm}}
.dsha-bar-title{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:0 4px}
.dsha-bar-title b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsha-pill{flex:none;font:${fontXs};color:${label3};border:1px solid ${borderSoft};border-radius:999px;padding:0 7px;line-height:18px}
.dsha-tool{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;min-width:28px;padding:0 6px;border:0;border-radius:${radiusSm};background:transparent;color:${label2};cursor:pointer;font:${fontXs}}
.dsha-tool:hover:not(:disabled){background:${hover};color:${label1}}
.dsha-tool:disabled{opacity:.4;cursor:default}
.dsha-tool[aria-pressed="true"]{background:${hover};color:${label1}}
.dsha-seg{flex:none;display:inline-flex;padding:2px;border-radius:8px;background:${hover};gap:2px}
.dsha-seg button{border:0;background:transparent;color:${label2};font:${fontXs};padding:2px 10px;border-radius:6px;cursor:pointer;height:24px}
.dsha-seg button[aria-pressed="true"]{background:${base};color:${label1};box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dsha-versions{flex:none;display:inline-flex;align-items:center;gap:0;font:${fontXs};color:${label2}}
.dsha-versions span{min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.dsha-menu-wrap{position:relative;flex:none}
.dsha-menu{position:absolute;right:0;top:32px;z-index:20;min-width:200px;padding:4px;border-radius:10px;border:1px solid ${border};background:${base};box-shadow:0 8px 24px rgba(0,0,0,.14)}
.dsha-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;color:${label1};font:${fontSm};padding:6px 10px;border-radius:6px;cursor:pointer}
.dsha-menu button:hover{background:${hover}}
.dsha-stage{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dsha-frame{flex:1 1 auto;width:100%;height:100%;border:0;background:#fff;display:block}
.dsha-frame[data-themed="dark"]{background:#16181d}
.dsha-code{flex:1 1 auto;min-height:0;overflow:auto;margin:0;padding:12px 0;font:var(--dsw-font-markdown-code-block, 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);background:var(--dsw-alias-markdown-code-block, ${layer});color:${label1}}
.dsha-code table{border-collapse:collapse}
.dsha-code td{padding:0 12px;vertical-align:top;white-space:pre}
.dsha-code td.dsha-ln{color:${label3};text-align:right;user-select:none;padding-right:16px;border-right:1px solid ${borderSoft}}
.dsha-status{padding:24px;color:${label3};font:${fontSm}}
.dsha-status[role="alert"]{color:${error}}
.dsha-error{flex:none;display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-top:1px solid color-mix(in srgb, ${error} 30%, transparent);background:color-mix(in srgb, ${error} 7%, ${base});font:${fontXs};color:${label1}}
.dsha-error-text{flex:1 1 auto;min-width:0;max-height:96px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace}
.dsha-error-text strong{display:block;font:${fontXs};font-weight:600;color:${error};margin-bottom:2px}
.dsha-error-actions{flex:none;display:flex;gap:4px;align-items:center}
.dsha-error-actions button{border:1px solid ${border};background:${base};color:${label1};border-radius:6px;font:${fontXs};padding:2px 8px;cursor:pointer;height:24px}
.dsha-error-actions button.dsha-primary{background:${accent};border-color:${accent};color:#fff}
.dsha-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:rgba(20,20,20,.86);color:#fff;font:${fontXs};padding:6px 12px;border-radius:999px;pointer-events:none;z-index:30}

.dsha-title-glyph{flex:none;margin-right:6px;vertical-align:-2px}
.dsha-gallery{height:100%;overflow:auto;padding:12px;box-sizing:border-box;background:${base};color:${label1}}
.dsha-gallery h2{font:${fontSm};font-weight:600;margin:4px 4px 12px;color:${label2}}
.dsha-gallery .dsha-card{max-width:none}
.dsha-gallery-empty{padding:24px 8px;color:${label3};font:${fontSm};line-height:1.6}
`
