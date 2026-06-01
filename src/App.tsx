import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useExternalLinks } from "./lib/useExternalLinks";

const HomePage = lazy(() => import("./pages/HomePage"));
const StateDashboard = lazy(() => import("./pages/StateDashboard"));
const CalculatorPage = lazy(() => import("./pages/CalculatorPage"));
const CountyDashboard = lazy(() => import("./pages/CountyDashboard"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));

export default function App() {
  useExternalLinks();
  return (
    <>
      <nav className="topnav">
        <Link to="/" className="brand">
          Mortgage rates by state
        </Link>
        <Link to="/calculator">Calculator</Link>
        <Link to="/methodology">Methodology</Link>
        <a
          href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </nav>
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
    </>
  );
}
