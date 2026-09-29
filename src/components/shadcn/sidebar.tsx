"use client";

// shadcn/ui Sidebar (new-york), trimmed to what Stampd uses and styled with the Neo-Brutalist tokens.
// Same API: SidebarProvider, Sidebar collapsible="icon", SidebarTrigger, SidebarRail, SidebarInset, SidebarMenu*.
import * as React from "react";
import { Dialog as SheetPrimitive, Slot, Tooltip as TooltipPrimitive } from "radix-ui";
import { PanelLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/use-mobile";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-state";

const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "4rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
}

export function SidebarProvider({
  defaultOpen = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & { defaultOpen?: boolean }) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [open, _setOpen] = React.useState(defaultOpen);
  const setOpen = React.useCallback((value: boolean) => {
    _setOpen(value);
    // Remembered across visits; the server reads it to render the right state first time.
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
  }, []);
  const toggleSidebar = React.useCallback(() => (isMobile ? setOpenMobile((o) => !o) : setOpen(!open)), [isMobile, open, setOpen]);

  // Ctrl/Cmd + B toggles the sidebar.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const state = open ? "expanded" : "collapsed";
  const value = React.useMemo<SidebarContextProps>(
    () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={{ "--sidebar-width": SIDEBAR_WIDTH, "--sidebar-width-icon": SIDEBAR_WIDTH_ICON, ...style } as React.CSSProperties}
          className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
          {...props}
        >
          {children}
        </div>
      </TooltipPrimitive.Provider>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ className, children, ...props }: React.ComponentProps<"div">) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    // Phones: a sheet sliding in from the left.
    return (
      <SheetPrimitive.Root open={openMobile} onOpenChange={setOpenMobile}>
        <SheetPrimitive.Portal>
          <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/60" />
          <SheetPrimitive.Content
            data-slot="sidebar"
            data-mobile="true"
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex h-full flex-col border-r-[2.5px] border-ink bg-sidebar p-0 text-sidebar-foreground"
            style={{ width: SIDEBAR_WIDTH_MOBILE }}
          >
            <SheetPrimitive.Title className="sr-only">Menu</SheetPrimitive.Title>
            <SheetPrimitive.Close aria-label="Close menu" className="absolute right-3 top-3 p-1 hover:bg-yellow">
              <X aria-hidden className="size-5" />
            </SheetPrimitive.Close>
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      </SheetPrimitive.Root>
    );
  }

  return (
    <div className="group peer hidden text-sidebar-foreground md:block" data-state={state} data-collapsible={state === "collapsed" ? "icon" : ""} data-slot="sidebar">
      {/* Holds the space in the layout; the panel itself is fixed. */}
      <div
        data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden h-svh w-(--sidebar-width) border-r-[2.5px] border-ink transition-[width] duration-200 ease-linear md:flex group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          className,
        )}
        {...props}
      >
        <div data-sidebar="sidebar" className="flex h-full w-full flex-col bg-sidebar">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar, isMobile, open } = useSidebar();
  const label = isMobile ? "Open menu" : open ? "Collapse sidebar" : "Expand sidebar";
  return (
    <button
      type="button"
      data-sidebar="trigger"
      aria-label={label}
      title={isMobile ? undefined : `${label} (Ctrl+B)`}
      className={cn("border-brutal inline-flex size-10 items-center justify-center bg-paper hover:bg-yellow", className)}
      onClick={(e) => {
        onClick?.(e);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeft aria-hidden className="size-5" />
    </button>
  );
}

// A thin strip on the sidebar's edge: click it to collapse or expand.
export function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar, open } = useSidebar();
  return (
    <button
      type="button"
      data-sidebar="rail"
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      tabIndex={-1}
      onClick={toggleSidebar}
      title={open ? "Collapse sidebar" : "Expand sidebar"}
      className={cn(
        "absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-ew-resize after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-ink md:flex",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return <main data-slot="sidebar-inset" className={cn("relative flex w-full min-w-0 flex-1 flex-col", className)} {...props} />;
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-sidebar="header" className={cn("flex flex-col gap-4 p-4 group-data-[collapsible=icon]:px-3", className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-sidebar="footer" className={cn("mt-auto flex flex-col gap-2 p-4 group-data-[collapsible=icon]:px-3", className)} {...props} />;
}

export function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-sidebar="content" className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-4 group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:px-3", className)} {...props} />;
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-sidebar="menu" className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-sidebar="menu-item" className={cn("relative", className)} {...props} />;
}

// Shows its label next to the icon; collapsed, only the icon, with the label as a tooltip.
export function SidebarMenuButton({
  asChild = false,
  isActive = false,
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean; tooltip?: string }) {
  const Comp = asChild ? Slot.Root : "button";
  const { isMobile, state } = useSidebar();
  const button = (
    <Comp
      data-sidebar="menu-button"
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-3 overflow-hidden border-l-4 border-transparent px-3 py-2 text-left font-bold outline-none transition-colors hover:bg-yellow/50 data-[active=true]:border-ink data-[active=true]:bg-yellow [&>svg]:size-4 [&>svg]:shrink-0 [&>span:last-child]:truncate",
        "group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:[&>span]:sr-only",
        className,
      )}
      {...props}
    />
  );
  if (!tooltip || isMobile || state !== "collapsed") return button;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{button}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="right" sideOffset={8} className="border-brutal z-50 bg-ink px-2 py-1 text-xs font-bold text-paper">
          {tooltip}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
