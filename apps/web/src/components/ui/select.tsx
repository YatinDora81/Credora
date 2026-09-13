import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const TriggerRef = React.createContext<React.MutableRefObject<HTMLButtonElement | null> | null>(null);

let lastInputWasPointer = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => (lastInputWasPointer = true), true);
  document.addEventListener("keydown", () => (lastInputWasPointer = false), true);
}

export function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  return (
    <TriggerRef.Provider value={trigger}>
      <SelectPrimitive.Root {...props} />
    </TriggerRef.Provider>
  );
}

export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const ctx = React.useContext(TriggerRef);
  return (
    <SelectPrimitive.Trigger
      ref={(el) => {
        if (ctx) ctx.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded border border-line-strong bg-surface px-2.5 text-left text-14 text-fg hover:border-faint data-[placeholder]:text-faint disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, onCloseAutoFocus, ...props }, ref) => {
  const ctx = React.useContext(TriggerRef);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position="popper"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          if (e.defaultPrevented || !lastInputWasPointer || !ctx?.current) return;
          e.preventDefault();
          ctx.current.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
        }}
        className={cn(
          "z-50 max-h-[min(26rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-32px)] overflow-hidden rounded-md border border-line-strong/70 bg-surface text-fg shadow-float",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

export function SelectLabel({ children }: { children: React.ReactNode }) {
  return <SelectPrimitive.Label className="px-2 pb-1 pt-2 text-12 text-faint">{children}</SelectPrimitive.Label>;
}

export function SelectSeparator() {
  return <SelectPrimitive.Separator className="mx-1 my-1 h-px bg-line" />;
}

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    textId?: string;
    accessory?: React.ReactNode;
    description?: React.ReactNode;
    descriptionId?: string;
  }
>(({ className, children, textId, accessory, description, descriptionId, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "grid cursor-default select-none grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 rounded px-2 py-2 text-fg outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-selected data-[disabled]:text-faint data-[highlighted]:shadow-[inset_2px_0_0_0_oklch(var(--accent))] sm:grid-cols-[16px_minmax(0,1fr)_auto]",
      className,
    )}
    {...props}
  >
    <span className="row-span-3 flex h-5 items-center sm:row-span-2">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5" strokeWidth={2} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText {...(textId ? { id: textId } : {})}>
      <span className="text-14 font-medium">{children}</span>
    </SelectPrimitive.ItemText>
    {accessory ? (
      <span className="col-start-2 row-start-3 flex items-start pt-0.5 sm:col-start-3 sm:row-span-2 sm:row-start-1">
        {accessory}
      </span>
    ) : null}
    {description ? (
      <span id={descriptionId} className="col-start-2 row-start-2 text-12 text-subtle">
        {description}
      </span>
    ) : null}
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;
