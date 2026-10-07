import { useEffect, useState } from 'react';
import { countDummyInputs } from './engine/dummy';
import { AssumptionsPage } from './pages/AssumptionsPage';
import { CriteriaPage } from './pages/CriteriaPage';
import { DataPage } from './pages/DataPage';
import { ModelsPage } from './pages/ModelsPage';
import { NetworkPage } from './pages/NetworkPage';
import { ProductsPage } from './pages/ProductsPage';
import { ResultsPage } from './pages/ResultsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { useApp } from './state/store';
import { NavLink, onNavigate, pathFromHash } from './ui/nav';

const ROUTES = [
  { path: 'network', label: 'Baseline network', page: NetworkPage },
  { path: 'products', label: 'Products', page: ProductsPage },
  { path: 'scenarios', label: 'Scenarios', page: ScenariosPage },
  { path: 'models', label: 'Model builder', page: ModelsPage },
  { path: 'criteria', label: 'Criteria and weights', page: CriteriaPage },
  { path: 'assumptions', label: 'Cost assumptions', page: AssumptionsPage },
  { path: 'results', label: 'Results', page: ResultsPage },
  { path: 'data', label: 'Data', page: DataPage },
] as const;

function currentPath(): string {
  const p = pathFromHash();
  return ROUTES.some((r) => r.path === p) ? p : 'network';
}

function useTheme() {
  const theme = useApp((s) => s.ws.settings.theme);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    const off = onNavigate((p) => setPath(ROUTES.some((r) => r.path === p) ? p : 'network'));
    return () => {
      window.removeEventListener('hashchange', onHash);
      off();
    };
  }, []);
  useTheme();
  const ws = useApp((s) => s.ws);
  const updateSettings = useApp((s) => s.updateSettings);
  const count = countDummyInputs(ws);
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const Page = route.page;

  return (
    <div className="app">
      <div className="dummy-banner" role="status">
        <span>Dummy data. Figures are placeholders for testing the tool, not company data.</span>
        <span className="count">
          {count.dummy} of {count.total} inputs are dummy data.
        </span>
      </div>
      <header className="topbar">
        <span className="title">Supply chain benchmark</span>
        <span className="muted small">Compare operating models against one baseline</span>
        <span className="spacer" />
        <label className="check small">
          Theme
          <select
            value={ws.settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as 'system' | 'light' | 'dark' })}
            aria-label="Colour theme"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>
      <div className="body">
        <nav className="sidenav" aria-label="Screens">
          {ROUTES.map((r, i) => (
            <NavLink key={r.path} to={r.path} current={r.path === path}>
              <span className="num">{i + 1}</span>
              {r.label}
            </NavLink>
          ))}
        </nav>
        <main className="main" id="main">
          <Page />
        </main>
      </div>
    </div>
  );
}
