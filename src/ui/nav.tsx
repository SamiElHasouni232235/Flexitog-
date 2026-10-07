// In-app navigation that does not rely on the browser following links,
// so it also works inside embedded viewers that intercept link clicks.

const NAV_EVENT = 'app-navigate';

/** Screen id from the address hash. Accepts "#results" and "#/results". */
export function pathFromHash(): string {
  return window.location.hash.replace(/^#\/?/, '');
}

export function navigate(path: string): void {
  try {
    window.history.replaceState(null, '', `#${path}`);
  } catch {
    // some embedded frames refuse history changes; the screen still switches
  }
  window.dispatchEvent(new CustomEvent<string>(NAV_EVENT, { detail: path }));
  document.getElementById('main')?.scrollTo({ top: 0 });
}

export function onNavigate(fn: (path: string) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(NAV_EVENT, handler);
  return () => window.removeEventListener(NAV_EVENT, handler);
}

/** Link to another screen. */
export function NavLink({
  to,
  children,
  current,
  className,
}: {
  to: string;
  children: React.ReactNode;
  current?: boolean;
  className?: string;
}) {
  return (
    <a
      href={`#${to}`}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
