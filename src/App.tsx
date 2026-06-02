import { lazy, Suspense } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { useExternalLinks } from "./lib/useExternalLinks";
import { CalculatorProvider } from "./lib/useCalculator";
import { ThemeProvider, ThemeToggle } from "./lib/useTheme";

const HomePage = lazy(() => import("./pages/HomePage"));
const StateDashboard = lazy(() => import("./pages/StateDashboard"));
const CalculatorPage = lazy(() => import("./pages/CalculatorPage"));
const CountyDashboard = lazy(() => import("./pages/CountyDashboard"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));

export default function App() {
  useExternalLinks();
  return (
    <ThemeProvider>
      <nav className="topnav">
        <Link to="/" className="brand">
          Mortgage rates by state
        </Link>
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
            <Route path="/state/:slug" element={<StateDashboard />} />
            <Route path="/state/:slug/county/:countyFips" element={<CountyDashboard />} />
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
