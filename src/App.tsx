import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import StateDashboard from "./pages/StateDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/state/:slug" element={<StateDashboard />} />
      <Route
        path="*"
        element={
          <div>
            <h1>Not found</h1>
            <p>
              <a href="/">Go home</a>
            </p>
          </div>
        }
      />
    </Routes>
  );
}
