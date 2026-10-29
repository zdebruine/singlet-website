import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, openSignIn: () => undefined }) }));
vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: () => null }));

import AdminAnalytics from "../pages/AdminAnalytics";

// Rows as the Analytics Engine SQL API returned them for a test visit on a preview (counts come back as strings).
const REPORTS = {
  summary: [{ views: "4", visitors: "1", sessions: "2", visible_ms: 70646 }],
  returning: [{ visitors: "1" }],
  signedIn: [{ visitors: "0" }],
  series: [{ t: "2026-10-29 11:00:00", views: "4", visitors: "1", sessions: "2" }],
  pages: [
    { key: "/browse", views: "1", visitors: "1", visible_ms: 47629, scroll: 58 },
    { key: "/about", views: "1", visitors: "1", visible_ms: 0, scroll: null },
  ],
  landing: [{ key: "/", sessions: "1", visitors: "1" }],
  referrers: [{ key: "", sessions: "1", visitors: "1" }],
  campaigns: [{ source: "linkedin", medium: "social", campaign: "launch", sessions: "1", visitors: "1" }],
  countries: [{ key: "US", visitors: "1", views: "4" }],
  devices: [{ key: "desktop", visitors: "1", views: "4" }],
  browsers: [{ key: "Chrome", visitors: "1", views: "4" }],
};

const renderPage = () => render(<MemoryRouter><AdminAnalytics /></MemoryRouter>);

afterEach(() => {
  vi.unstubAllGlobals();
  auth.user = null;
});

describe("/admin/analytics", () => {
  it("asks a signed-out visitor to sign in and fetches nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    expect(screen.getByText(/Sign in with an admin account/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders every report from the API rows", async () => {
    auth.user = { id: "admin" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ days: 7, host: "singlet.bio", generated_at: "2026-10-29T12:00:00Z", reports: REPORTS })));
    renderPage();
    expect(await screen.findByText("Returning visitors")).toBeTruthy();
    expect(screen.getByText("100% of visitors")).toBeTruthy();
    expect(screen.getByText("2.0 per session")).toBeTruthy();
    expect(screen.getByText("35s")).toBeTruthy(); // 70.6 s visible over 2 sessions
    expect(screen.getByText("48s")).toBeTruthy(); // /browse time on page (47.6 s)
    expect(screen.getByText("58%")).toBeTruthy();
    expect(screen.getByText("linkedin / social / launch")).toBeTruthy();
    expect(screen.getByText("Direct or unknown")).toBeTruthy();
    expect(screen.getByText("US")).toBeTruthy();
  });

  it("shows the server's message when analytics are not set up", async () => {
    auth.user = { id: "admin" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "not_configured", message: "Set the CF_ANALYTICS_TOKEN secret." }, { status: 503 })));
    renderPage();
    expect(await screen.findByText("Set the CF_ANALYTICS_TOKEN secret.")).toBeTruthy();
  });
});
