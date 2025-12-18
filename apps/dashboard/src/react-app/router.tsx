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
      { index: true, element: <Dashboard /> },
      { path: "explore", element: <Explore /> },
      { path: "agent/:mint", element: <AgentDetails /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
