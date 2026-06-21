import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { HomeSnapshot } from "../types";
import { HomePage } from "./HomePage";

const snapshot: HomeSnapshot = {
  settings: {
    siteName: "PrizeJito.com",
    logoUrl: "/prizejito-logo.png",
    maxWinAmount: 10_000,
    marqueeSpeedSeconds: 28,
    games: { carrom: false, hockey: false, pool: false },
    social: { telegram: "", whatsapp: "", facebook: "" },
  },
  winners: [
    {
      id: "winner-1",
      name: "Test Winner",
      avatar: "/avatar-leaf.svg",
      amount: "500",
      isPromotional: false,
      createdAt: new Date().toISOString(),
    },
  ],
  leaderboard: [],
  tournaments: [],
  upcomingTournaments: [],
  unreadNotifications: 0,
  serverTime: new Date().toISOString(),
};

describe("HomePage", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("bn");
  });

  it("renders live database content and lets guests browse tournaments", () => {
    const onOpenTournaments = vi.fn();
    render(
      <MemoryRouter>
        <HomePage
          snapshot={snapshot}
          loading={false}
          error=""
          onOpenTournaments={onOpenTournaments}
          onRefresh={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("PrizeJito.com".toUpperCase())).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(i18n.t("playStart")) }),
    );
    expect(onOpenTournaments).toHaveBeenCalledOnce();
  });
});
