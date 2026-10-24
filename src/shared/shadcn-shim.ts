/**
 * A small, dependency-free stand-in for the most common shadcn/ui components,
 * so React artifacts written for Claude (`import { Card } from "@/components/ui/card"`)
 * render here too. Every `@/components/ui/*` and `@/lib/utils` import resolves
 * to this one module inside the sandboxed iframe. It is plain JavaScript source
 * (no JSX) that imports React through the iframe's import map.
 */
export const SHADCN_SHIM = String.raw`
import * as React from 'react';
const h = React.createElement;
export function cn(...parts) {
  const out = [];
  const walk = (p) => {
    if (!p) return;
    if (typeof p === 'string' || typeof p === 'number') out.push(String(p));
    else if (Array.isArray(p)) p.forEach(walk);
    else if (typeof p === 'object') for (const k in p) if (p[k]) out.push(k);
  };
  parts.forEach(walk);
  return out.join(' ');
}
export const clsx = cn;
function styled(tag, base, name) {
  const C = React.forwardRef(function (props, ref) {
    const { className, asChild, ...rest } = props;
    return h(tag, { ref, className: cn(base, className), ...rest });
  });
  C.displayName = name;
  return C;
}
const buttonVariants = {
  default: 'bg-slate-900 text-white hover:bg-slate-800',
  destructive: 'bg-red-600 text-white hover:bg-red-500',
  outline: 'border border-slate-300 bg-white hover:bg-slate-100 text-slate-900',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  ghost: 'hover:bg-slate-100 text-slate-900',
  link: 'text-slate-900 underline-offset-4 hover:underline',
};
const buttonSizes = { default: 'h-10 px-4 py-2', sm: 'h-9 rounded-md px-3', lg: 'h-11 rounded-md px-8', icon: 'h-10 w-10' };
export const Button = React.forwardRef(function Button({ className, variant = 'default', size = 'default', asChild, ...props }, ref) {
  return h('button', { ref, className: cn('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50', buttonVariants[variant] || buttonVariants.default, buttonSizes[size] || buttonSizes.default, className), ...props });
});
export const Card = styled('div', 'rounded-lg border border-slate-200 bg-white text-slate-950 shadow-sm', 'Card');
export const CardHeader = styled('div', 'flex flex-col space-y-1.5 p-6', 'CardHeader');
export const CardTitle = styled('h3', 'text-2xl font-semibold leading-none tracking-tight', 'CardTitle');
export const CardDescription = styled('p', 'text-sm text-slate-500', 'CardDescription');
export const CardContent = styled('div', 'p-6 pt-0', 'CardContent');
export const CardFooter = styled('div', 'flex items-center p-6 pt-0', 'CardFooter');
export const Input = styled('input', 'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50', 'Input');
export const Textarea = styled('textarea', 'flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400', 'Textarea');
export const Label = styled('label', 'text-sm font-medium leading-none', 'Label');
export const Separator = React.forwardRef(function Separator({ className, orientation = 'horizontal', ...props }, ref) {
  return h('div', { ref, role: 'separator', className: cn('shrink-0 bg-slate-200', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className), ...props });
});
const badgeVariants = { default: 'bg-slate-900 text-white', secondary: 'bg-slate-100 text-slate-900', destructive: 'bg-red-600 text-white', outline: 'border border-slate-300 text-slate-900' };
export function Badge({ className, variant = 'default', ...props }) {
  return h('div', { className: cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', badgeVariants[variant] || badgeVariants.default, className), ...props });
}
export function Alert({ className, variant = 'default', ...props }) {
  return h('div', { role: 'alert', className: cn('relative w-full rounded-lg border p-4', variant === 'destructive' ? 'border-red-300 text-red-700' : 'border-slate-200 text-slate-900', className), ...props });
}
export const AlertTitle = styled('h5', 'mb-1 font-medium leading-none tracking-tight', 'AlertTitle');
export const AlertDescription = styled('div', 'text-sm', 'AlertDescription');
export function Progress({ className, value = 0, ...props }) {
  return h('div', { className: cn('relative h-4 w-full overflow-hidden rounded-full bg-slate-100', className), ...props },
    h('div', { className: 'h-full bg-slate-900 transition-all', style: { width: Math.max(0, Math.min(100, value || 0)) + '%' } }));
}
function useControllable(value, defaultValue, onChange) {
  const [inner, setInner] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = React.useCallback((next) => { if (!controlled) setInner(next); if (onChange) onChange(next); }, [controlled, onChange]);
  return [current, set];
}
export function Switch({ checked, defaultChecked = false, onCheckedChange, className, disabled, ...props }) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  return h('button', { type: 'button', role: 'switch', 'aria-checked': !!on, disabled, onClick: () => setOn(!on),
    className: cn('inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50', on ? 'bg-slate-900' : 'bg-slate-200', className), ...props },
    h('span', { className: cn('block h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5') }));
}
export function Checkbox({ checked, defaultChecked = false, onCheckedChange, className, disabled, ...props }) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  return h('button', { type: 'button', role: 'checkbox', 'aria-checked': !!on, disabled, onClick: () => setOn(!on),
    className: cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-slate-900', on ? 'bg-slate-900 text-white' : 'bg-white', className), ...props },
    on ? h('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 3 }, h('path', { d: 'M20 6 9 17l-5-5' })) : null);
}
export function Slider({ value, defaultValue = [0], min = 0, max = 100, step = 1, onValueChange, className, disabled }) {
  const [v, setV] = useControllable(value, defaultValue, onValueChange);
  const n = Array.isArray(v) ? v[0] : v;
  return h('input', { type: 'range', min, max, step, value: n, disabled, onChange: (e) => setV([Number(e.target.value)]), className: cn('w-full accent-slate-900', className) });
}
const TabsCtx = React.createContext(null);
export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }) {
  const [v, setV] = useControllable(value, defaultValue, onValueChange);
  return h(TabsCtx.Provider, { value: { value: v, setValue: setV } }, h('div', { className, ...props }, children));
}
export const TabsList = styled('div', 'inline-flex h-10 items-center justify-center rounded-md bg-slate-100 p-1 text-slate-500', 'TabsList');
export function TabsTrigger({ value, className, children, ...props }) {
  const ctx = React.useContext(TabsCtx);
  const active = ctx && ctx.value === value;
  return h('button', { type: 'button', role: 'tab', 'aria-selected': !!active, onClick: () => ctx && ctx.setValue(value),
    className: cn('inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all', active ? 'bg-white text-slate-950 shadow-sm' : '', className), ...props }, children);
}
export function TabsContent({ value, className, children, ...props }) {
  const ctx = React.useContext(TabsCtx);
  if (!ctx || ctx.value !== value) return null;
  return h('div', { role: 'tabpanel', className: cn('mt-2', className), ...props }, children);
}
const SelectCtx = React.createContext(null);
export function Select({ value, defaultValue, onValueChange, children, disabled }) {
  const [v, setV] = useControllable(value, defaultValue, onValueChange);
  const [open, setOpen] = React.useState(false);
  const labels = React.useRef(new Map());
  const [, force] = React.useReducer((x) => x + 1, 0);
  const ctx = { value: v, setValue: (next) => { setV(next); setOpen(false); }, open, setOpen, disabled, labels: labels.current, refresh: force };
  return h(SelectCtx.Provider, { value: ctx }, h('div', { className: 'relative' }, children));
}
export function SelectTrigger({ className, children, ...props }) {
  const ctx = React.useContext(SelectCtx);
  return h('button', { type: 'button', disabled: ctx && ctx.disabled, onClick: () => ctx && ctx.setOpen(!ctx.open),
    className: cn('flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm', className), ...props },
    children, h('span', { className: 'ml-2 opacity-50' }, '▾'));
}
export function SelectValue({ placeholder }) {
  const ctx = React.useContext(SelectCtx);
  if (!ctx || ctx.value === undefined || ctx.value === '') return h('span', { className: 'text-slate-400' }, placeholder || '');
  return h('span', null, ctx.labels.get(ctx.value) ?? String(ctx.value));
}
export function SelectContent({ className, children }) {
  const ctx = React.useContext(SelectCtx);
  return h('div', { className: cn('absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-md', className), style: { display: ctx && ctx.open ? 'block' : 'none' } }, children);
}
export function SelectItem({ value, className, children }) {
  const ctx = React.useContext(SelectCtx);
  React.useEffect(() => {
    if (!ctx) return;
    const text = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined;
    if (text !== undefined && ctx.labels.get(value) !== text) { ctx.labels.set(value, text); ctx.refresh(); }
  });
  const selected = ctx && ctx.value === value;
  return h('div', { role: 'option', 'aria-selected': !!selected, onClick: () => ctx && ctx.setValue(value),
    className: cn('cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-slate-100', selected ? 'font-medium' : '', className) }, children);
}
export const SelectGroup = styled('div', '', 'SelectGroup');
export const SelectLabel = styled('div', 'px-2 py-1.5 text-sm font-semibold', 'SelectLabel');
const DialogCtx = React.createContext(null);
export function Dialog({ open, defaultOpen = false, onOpenChange, children }) {
  const [o, setO] = useControllable(open, defaultOpen, onOpenChange);
  return h(DialogCtx.Provider, { value: { open: o, setOpen: setO } }, children);
}
export function DialogTrigger({ children, asChild }) {
  const ctx = React.useContext(DialogCtx);
  const onClick = () => ctx && ctx.setOpen(true);
  if (asChild && React.isValidElement(children)) return React.cloneElement(children, { onClick });
  return h('button', { type: 'button', onClick }, children);
}
export function DialogContent({ className, children }) {
  const ctx = React.useContext(DialogCtx);
  if (!ctx || !ctx.open) return null;
  return h('div', { className: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50', onClick: () => ctx.setOpen(false) },
    h('div', { className: cn('relative w-full max-w-lg rounded-lg border bg-white p-6 shadow-lg', className), onClick: (e) => e.stopPropagation() },
      children, h('button', { type: 'button', className: 'absolute right-4 top-4 opacity-60 hover:opacity-100', onClick: () => ctx.setOpen(false), 'aria-label': 'Close' }, '✕')));
}
export const DialogHeader = styled('div', 'flex flex-col space-y-1.5 text-center sm:text-left', 'DialogHeader');
export const DialogFooter = styled('div', 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', 'DialogFooter');
export const DialogTitle = styled('h2', 'text-lg font-semibold leading-none tracking-tight', 'DialogTitle');
export const DialogDescription = styled('p', 'text-sm text-slate-500', 'DialogDescription');
export const ScrollArea = styled('div', 'relative overflow-auto', 'ScrollArea');
export const Table = styled('table', 'w-full caption-bottom text-sm', 'Table');
export const TableHeader = styled('thead', '[&_tr]:border-b', 'TableHeader');
export const TableBody = styled('tbody', '[&_tr:last-child]:border-0', 'TableBody');
export const TableFooter = styled('tfoot', 'border-t bg-slate-100/50 font-medium', 'TableFooter');
export const TableRow = styled('tr', 'border-b transition-colors hover:bg-slate-100/50', 'TableRow');
export const TableHead = styled('th', 'h-12 px-4 text-left align-middle font-medium text-slate-500', 'TableHead');
export const TableCell = styled('td', 'p-4 align-middle', 'TableCell');
export const TableCaption = styled('caption', 'mt-4 text-sm text-slate-500', 'TableCaption');
export const Avatar = styled('span', 'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', 'Avatar');
export const AvatarImage = styled('img', 'aspect-square h-full w-full', 'AvatarImage');
export const AvatarFallback = styled('span', 'flex h-full w-full items-center justify-center rounded-full bg-slate-100', 'AvatarFallback');
export const Skeleton = styled('div', 'animate-pulse rounded-md bg-slate-100', 'Skeleton');
const AccordionCtx = React.createContext(null);
export function Accordion({ type = 'single', collapsible, defaultValue, className, children }) {
  const [open, setOpen] = React.useState(() => new Set(Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []));
  const toggle = (v) => setOpen((prev) => { const next = new Set(type === 'multiple' ? prev : []); if (prev.has(v)) { if (type === 'multiple') next.delete(v); } else next.add(v); return next; });
  return h(AccordionCtx.Provider, { value: { open, toggle } }, h('div', { className }, children));
}
const ItemCtx = React.createContext(null);
export function AccordionItem({ value, className, children }) {
  return h(ItemCtx.Provider, { value }, h('div', { className: cn('border-b', className) }, children));
}
export function AccordionTrigger({ className, children }) {
  const ctx = React.useContext(AccordionCtx); const value = React.useContext(ItemCtx);
  return h('button', { type: 'button', onClick: () => ctx && ctx.toggle(value), className: cn('flex w-full items-center justify-between py-4 font-medium hover:underline', className) }, children, h('span', null, ctx && ctx.open.has(value) ? '▴' : '▾'));
}
export function AccordionContent({ className, children }) {
  const ctx = React.useContext(AccordionCtx); const value = React.useContext(ItemCtx);
  if (!ctx || !ctx.open.has(value)) return null;
  return h('div', { className: cn('pb-4 pt-0 text-sm', className) }, children);
}
export function TooltipProvider({ children }) { return children; }
export function Tooltip({ children }) { return children; }
export function TooltipTrigger({ children }) { return children; }
export function TooltipContent() { return null; }
export { buttonVariants };
`
