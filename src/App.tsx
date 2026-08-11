import { lazy, Suspense } from "react";
import { Link, NavLink, Outlet, Route, Routes, useParams } from "react-router-dom";
import { useExternalLinks } from "./lib/useExternalLinks";
import { CalculatorProvider } from "./lib/useCalculator";
import { ThemeProvider, ThemeToggle } from "./lib/useTheme";
import { ChartToggleProvider } from "./lib/useChartToggles";
import { ErrorBoundary } from "./components/ErrorBoundary";

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
        {/*
          Root boundary, deliberately OUTSIDE the Suspense (see the docstring
          on ErrorBoundary): every route below is lazy(), so a chunk that
          fails to load rejects the import promise and never mounts. A
          boundary inside Suspense cannot catch that, and the user is left
          with an empty #root.

          Retry reloads the document rather than clearing state. The dominant
          failure here is a stale content-hashed chunk 404 — every daily data
          deploy rotates the route-chunk hashes, so a tab left open across a
          deploy requests URLs that no longer exist. setState would just
          re-request the same dead URL; only re-fetching index.html picks up
          the new asset manifest.
        */}
        <ErrorBoundary
          fallback={() => (
            <div className="error-boundary-fallback" role="alert">
              <p>
                <b>Couldn't load this page.</b> The site may have been updated
                since you opened this tab. Reloading fetches the current
                version.
              </p>
              <button
                type="button"
                className="error-boundary-retry"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          )}
        >
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
        </ErrorBoundary>
      </CalculatorProvider>
    </ThemeProvider>
  );
}
