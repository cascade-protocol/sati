import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "./layouts/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { Explore } from "./pages/Explore";
import { AgentDetails } from "./pages/AgentDetails";
import { SigningTest } from "./pages/SigningTest";
import { Predict } from "./pages/Predict";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      // Explore is the home page
      { index: true, element: <Explore /> },
      // My Profile
      { path: "profile", element: <Dashboard /> },
      { path: "agent/:mint", element: <AgentDetails /> },
      // AI Predictions demo
      { path: "predict", element: <Predict /> },
      // OCMSF signing test page
      { path: "signing-test", element: <SigningTest /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
