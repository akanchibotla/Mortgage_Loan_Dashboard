import { lazy, Suspense } from "react";
import { Link, NavLink, Outlet, Route, Routes, useParams } from "react-router-dom";
import { useExternalLinks } from "./lib/useExternalLinks";
import { CalculatorProvider } from "./lib/useCalculator";
import { ThemeProvider, ThemeToggle } from "./lib/useTheme";
import { ChartToggleProvider } from "./lib/useChartToggles";

const HomePage = lazy(() => import("./pages/HomePage"));
const StateDashboard = lazy(() => import("./pages/StateDashboard"));
const CalculatorPage = lazy(() => import("./pages/CalculatorPage"));
const CountyDashboard = lazy(() => import("./pages/CountyDashboard"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));

// Layout route for the state-scoped subtree. Mounts a fresh chart-toggle
// context per state slug (the key={slug} forces React to unmount + remount
// when navigating between states, satisfying the "reset on state change"
// rule). Persists across state ↔ county navigation within the same slug.
function StateChartScope() {
  const { slug } = useParams();
  return (
    <ChartToggleProvider key={slug ?? ""}>
      <Outlet />
    </ChartToggleProvider>
  );
}

export default function App() {
  useExternalLinks();
  return (
    <ThemeProvider>
      <nav className="topnav">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `brand${isActive ? " active" : ""}`}
        >
          Mortgage rates by state
        </NavLink>
        <NavLink
          to="/calculator"
          className={({ isActive }) => `topnav-strong${isActive ? " active" : ""}`}
        >
          Calculator
        </NavLink>
        <NavLink
          to="/methodology"
          className={({ isActive }) =>
            `topnav-right${isActive ? " active" : ""}`
          }
        >
          Methodology
        </NavLink>
        <ThemeToggle />
      </nav>
      <CalculatorProvider>
        <Suspense fallback={<p className="loading">Loading…</p>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/state/:slug" element={<StateChartScope />}>
              <Route index element={<StateDashboard />} />
              <Route path="county/:countyFips" element={<CountyDashboard />} />
            </Route>
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route
              path="*"
              element={
                <div>
                  <h1>Not found</h1>
                  <p>
                    <Link to="/">Go home</Link>
                  </p>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </CalculatorProvider>
    </ThemeProvider>
  );
}
