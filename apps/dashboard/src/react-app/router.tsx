import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "./layouts/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { Explore } from "./pages/Explore";
import { AgentDetails } from "./pages/AgentDetails";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      // Explore is the home page
      { index: true, element: <Explore /> },
      // My Profile (formerly just Dashboard)
      { path: "dashboard", element: <Dashboard /> },
      { path: "agent/:mint", element: <AgentDetails /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
