import { Crown, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { resolvedAvatar } from "../lib/avatar";
import type {
  TournamentDetails,
  TournamentMatch,
  TournamentSummary,
} from "../types";

const COL_WIDTH = 158;
const COL_GAP = 48;
const ROW_UNIT = 36;
const LABEL_HEIGHT = 22;

type BracketPlayer = TournamentMatch["players"][number];

type BracketSlot = {
  key: string;
  col: number;
  rowStart: number;
  rowSpan: number;
  match: TournamentMatch;
  player?: BracketPlayer;
  variant: "pair" | "solo" | "final-champion" | "final-pair";
};

function roundLabel(
  round: number,
  totalRounds: number,
  boardType: "2p" | "4p",
  bn: boolean,
) {
  if (round >= totalRounds) {
    return boardType === "4p"
      ? bn
        ? "ফাইনাল বোর্ড"
        : "Final Board"
      : bn
        ? "ফাইনাল"
        : "Final";
  }
  const stepsFromFinal = totalRounds - round;
  if (boardType === "2p") {
    const labels = bn
      ? ["সেমি ফাইনাল", "কোয়ার্টার ফাইনাল", "রাউন্ড ১৬", "রাউন্ড ৩২", "রাউন্ড ৬৪"]
      : ["Semi Final", "Quarter Final", "Round of 16", "Round of 32", "Round of 64"];
    return labels[stepsFromFinal - 1] ?? `${bn ? "রাউন্ড" : "Round"} ${round}`;
  }
  const labels = bn
    ? ["সেমি ফাইনাল বোর্ড", "কোয়ার্টার ফাইনাল বোর্ড", "রাউন্ড ১৬ বোর্ড", "রাউন্ড ৩২ বোর্ড"]
    : ["Semi Final Board", "Quarter Final Board", "Round of 16 Board", "Round of 32 Board"];
  return labels[stepsFromFinal - 1] ?? `${bn ? "রাউন্ড" : "Round"} ${round} Board`;
}

function sortMatches(matches: TournamentMatch[]) {
  return [...matches].sort((a, b) => {
    const byNumber = (a.matchNumber ?? 0) - (b.matchNumber ?? 0);
    if (byNumber !== 0) return byNumber;
    return a.id.localeCompare(b.id);
  });
}

function getPlayerStatus(
  match: TournamentMatch,
  playerId: string,
  tournament: TournamentSummary,
  bn: boolean,
): { label: string; tone: "won" | "lost" | "final" | "waiting" | "playing" } {
  const isFinalRound = match.round >= tournament.totalRounds;
  if (match.status === "completed") {
    if (match.winnerId === playerId) {
      if (isFinalRound) {
        return { label: bn ? "ফাইনালে" : "Final", tone: "final" };
      }
      return { label: bn ? "জিতেছে" : "Won", tone: "won" };
    }
    if (tournament.boardType === "4p" && match.runnerUpId === playerId) {
      if (isFinalRound) {
        return { label: bn ? "২য়" : "2nd", tone: "won" };
      }
      return { label: bn ? "জিতেছে" : "Qualified", tone: "won" };
    }
    return { label: bn ? "পরাজিত" : "Lost", tone: "lost" };
  }
  if (match.status === "active") {
    return { label: bn ? "খেলছে" : "Playing", tone: "playing" };
  }
  return { label: bn ? "অপেক্ষা" : "Waiting", tone: "waiting" };
}

function estimateMatchRowUnits(
  match: TournamentMatch,
  boardType: TournamentSummary["boardType"],
) {
  const players = Math.max(1, match.players.length);
  if (boardType === "4p") {
    return Math.max(6, players * 2);
  }
  return Math.max(4, players);
}

function buildSlots(
  rounds: Array<{ round: number; matches: TournamentMatch[] }>,
  tournament: TournamentSummary,
): BracketSlot[] {
  if (rounds.length === 0) return [];

  const firstCount = rounds[0]!.matches.length;
  const firstRoundMatches = rounds[0]!.matches;
  const maxMatchRows = Math.max(
    4,
    ...firstRoundMatches.map((match) =>
      estimateMatchRowUnits(match, tournament.boardType),
    ),
  );
  const rowUnits = Math.max(4, firstCount * maxMatchRows);
  const slots: BracketSlot[] = [];

  rounds.forEach(({ round, matches }, col) => {
    const isFirst = col === 0;
    const isLast = round >= tournament.totalRounds;
    const soloMiddle =
      tournament.boardType === "2p" && !isFirst && !isLast;

    if (soloMiddle) {
      const allPlayers = matches.flatMap((match) =>
        match.players.map((player) => ({ match, player })),
      );
      const step = rowUnits / Math.max(1, allPlayers.length);
      allPlayers.forEach(({ match, player }, index) => {
        slots.push({
          key: `${round}-${player.user.id}`,
          col,
          rowStart: Math.floor(index * step) + 1,
          rowSpan: Math.max(3, Math.floor(step)),
          match,
          player,
          variant: "solo",
        });
      });
      return;
    }

    sortMatches(matches).forEach((match, matchIndex) => {
      if (
        isLast &&
        tournament.boardType === "2p" &&
        match.status === "completed" &&
        match.winnerId
      ) {
        const winner = match.players.find(({ user }) => user.id === match.winnerId);
        if (winner) {
          slots.push({
            key: `${match.id}-champion`,
            col,
            rowStart: Math.floor((rowUnits - 4) / 2) + 1,
            rowSpan: 4,
            match,
            player: winner,
            variant: "final-champion",
          });
          return;
        }
      }

      const unitPerMatch = rowUnits / matches.length;
      const minSpan = estimateMatchRowUnits(match, tournament.boardType);
      slots.push({
        key: match.id,
        col,
        rowStart: Math.floor(matchIndex * unitPerMatch) + 1,
        rowSpan: Math.max(minSpan, Math.floor(unitPerMatch)),
        match,
        variant: isLast ? "final-pair" : "pair",
      });
    });
  });

  return slots;
}

function slotCenterY(slot: BracketSlot) {
  return LABEL_HEIGHT + (slot.rowStart - 1 + slot.rowSpan / 2) * ROW_UNIT;
}

function slotLeftX(col: number) {
  return col * (COL_WIDTH + COL_GAP);
}

function slotRightX(col: number) {
  return slotLeftX(col) + COL_WIDTH;
}

function buildConnectorPaths(slots: BracketSlot[], colCount: number): string[] {
  const paths: string[] = [];
  const byCol = new Map<number, BracketSlot[]>();
  slots.forEach((slot) => {
    const list = byCol.get(slot.col) ?? [];
    list.push(slot);
    byCol.set(slot.col, list);
  });

  for (let col = 0; col < colCount - 1; col += 1) {
    const left = [...(byCol.get(col) ?? [])].sort(
      (a, b) => a.rowStart - b.rowStart,
    );
    const right = [...(byCol.get(col + 1) ?? [])].sort(
      (a, b) => a.rowStart - b.rowStart,
    );
    if (left.length === 0 || right.length === 0) continue;

    const mergeX = slotRightX(col) + COL_GAP / 2;
    const targetX = slotLeftX(col + 1);

    if (left.length === right.length) {
      left.forEach((source, index) => {
        const target = right[index];
        if (!target) return;
        paths.push(
          `M ${slotRightX(col)} ${slotCenterY(source)} H ${mergeX} V ${slotCenterY(target)} H ${targetX}`,
        );
      });
      continue;
    }

    const groupSize = Math.max(1, Math.ceil(left.length / right.length));
    right.forEach((target, targetIndex) => {
      const feeders = left.slice(
        targetIndex * groupSize,
        targetIndex * groupSize + groupSize,
      );
      if (feeders.length === 0) return;

      const targetY = slotCenterY(target);

      if (feeders.length === 1) {
        paths.push(
          `M ${slotRightX(col)} ${slotCenterY(feeders[0]!)} H ${mergeX} V ${targetY} H ${targetX}`,
        );
        return;
      }

      const ys = feeders.map(slotCenterY);
      const midY = (Math.min(...ys) + Math.max(...ys)) / 2;

      feeders.forEach((feeder) => {
        paths.push(
          `M ${slotRightX(col)} ${slotCenterY(feeder)} H ${mergeX} V ${midY}`,
        );
      });
      paths.push(`M ${mergeX} ${midY} H ${targetX} V ${targetY}`);
    });
  }

  return paths;
}

function BracketPlayerRow({
  match,
  row,
  tournament,
  bn,
  isYou,
}: {
  match: TournamentMatch;
  row: BracketPlayer;
  tournament: TournamentSummary;
  bn: boolean;
  isYou?: boolean;
}) {
  const status = getPlayerStatus(match, row.user.id, tournament, bn);
  return (
    <div className={`bracket-tree__player ${status.tone}${isYou ? " is-you" : ""}`}>
      <span className="bracket-tree__player-avatar">
        <img src={resolvedAvatar(row.user.avatar, row.user.gameId)} alt="" />
      </span>
      <div className="bracket-tree__player-copy">
        <strong>{row.user.name}</strong>
        <em>{status.label}</em>
      </div>
    </div>
  );
}

function BracketBox({
  slot,
  tournament,
  bn,
  userId,
  onOpen,
}: {
  slot: BracketSlot;
  tournament: TournamentSummary;
  bn: boolean;
  userId?: string | undefined;
  onOpen?: ((matchId: string) => void) | undefined;
}) {
  const { match, player, variant } = slot;
  const containsYou =
    Boolean(userId) &&
    match.players.some(({ user }) => user.id === userId);

  if (variant === "final-champion" && player) {
    return (
      <button
        type="button"
        className={`bracket-tree__match bracket-tree__match--final bracket-tree__match--solo${
          player.user.id === userId ? " bracket-tree__match--you" : ""
        }`}
        onClick={() => onOpen?.(match.id)}
        aria-label={`${player.user.name} ${bn ? "ফাইনাল" : "final"}`}
      >
        <span className="bracket-tree__crown" aria-hidden="true">
          <Crown size={17} strokeWidth={2.2} />
        </span>
        <BracketPlayerRow
          match={match}
          row={player}
          tournament={tournament}
          bn={bn}
          isYou={player.user.id === userId}
        />
      </button>
    );
  }

  if (variant === "solo" && player) {
    return (
      <button
        type="button"
        className={`bracket-tree__match bracket-tree__match--solo${
          player.user.id === userId ? " bracket-tree__match--you" : ""
        }`}
        onClick={() => onOpen?.(match.id)}
      >
        <BracketPlayerRow
          match={match}
          row={player}
          tournament={tournament}
          bn={bn}
          isYou={player.user.id === userId}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`bracket-tree__match${
        variant === "final-pair" ? " bracket-tree__match--final-round" : ""
      }${containsYou ? " bracket-tree__match--you" : ""}`}
      onClick={() => onOpen?.(match.id)}
    >
      {match.players.map((row, index) => (
        <div className="bracket-tree__player-wrap" key={row.user.id}>
          {index > 0 && <span className="bracket-tree__divider" aria-hidden="true" />}
          <BracketPlayerRow
            match={match}
            row={row}
            tournament={tournament}
            bn={bn}
            isYou={row.user.id === userId}
          />
        </div>
      ))}
    </button>
  );
}

function useCompactBracketLayout() {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 720px)").matches
      : false,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return compact;
}

function BracketMobileList({
  rounds,
  tournament,
  bn,
  userId,
  onOpenMatch,
}: {
  rounds: Array<{ round: number; matches: TournamentMatch[] }>;
  tournament: TournamentSummary;
  bn: boolean;
  userId?: string | undefined;
  onOpenMatch?: ((matchId: string) => void) | undefined;
}) {
  return (
    <div className="bracket-mobile-list">
      {rounds.map(({ round, matches }) => (
        <section key={round} className="bracket-mobile-round">
          <h3 className="bracket-mobile-round__title">
            {roundLabel(round, tournament.totalRounds, tournament.boardType, bn)}
          </h3>
          <div className="bracket-mobile-round__matches">
            {sortMatches(matches).map((match) => {
              const containsYou = Boolean(
                userId && match.players.some(({ user }) => user.id === userId),
              );
              return (
                <button
                  key={match.id}
                  type="button"
                  className={`bracket-mobile-match${
                    containsYou ? " bracket-mobile-match--you" : ""
                  }${match.round >= tournament.totalRounds ? " bracket-mobile-match--final" : ""}`}
                  onClick={() => onOpenMatch?.(match.id)}
                >
                  {match.players.map((row, index) => (
                    <div className="bracket-mobile-match__row" key={row.user.id}>
                      {index > 0 && (
                        <span className="bracket-mobile-match__divider" aria-hidden="true" />
                      )}
                      <BracketPlayerRow
                        match={match}
                        row={row}
                        tournament={tournament}
                        bn={bn}
                        isYou={row.user.id === userId}
                      />
                    </div>
                  ))}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TournamentBracketTree({
  details,
  language,
  userId,
  onOpenMatch,
}: {
  details: TournamentDetails;
  language: string;
  userId?: string | undefined;
  onOpenMatch?: ((matchId: string) => void) | undefined;
}) {
  const bn = language === "bn";
  const { tournament, matches } = details;
  const compact = useCompactBracketLayout();

  const rounds = useMemo(() => {
    const grouped = new Map<number, TournamentMatch[]>();
    for (const match of matches) {
      const bucket = grouped.get(match.round) ?? [];
      bucket.push(match);
      grouped.set(match.round, bucket);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, roundMatches]) => ({
        round,
        matches: sortMatches(roundMatches),
      }));
  }, [matches]);

  const layout = useMemo(() => {
    const slots = buildSlots(rounds, tournament);
    const firstCount = rounds[0]?.matches.length ?? 1;
    const firstRoundMatches = rounds[0]?.matches ?? [];
    const maxMatchRows = Math.max(
      4,
      ...firstRoundMatches.map((match) =>
        estimateMatchRowUnits(match, tournament.boardType),
      ),
    );
    const rowUnits = Math.max(4, firstCount * maxMatchRows);
    const paths = buildConnectorPaths(slots, rounds.length);
    const width =
      rounds.length * COL_WIDTH + Math.max(0, rounds.length - 1) * COL_GAP;
    const height = LABEL_HEIGHT + rowUnits * ROW_UNIT + 8;
    const labels = rounds.map(({ round }) =>
      roundLabel(round, tournament.totalRounds, tournament.boardType, bn),
    );
    return { slots, rowUnits, paths, width, height, labels };
  }, [bn, rounds, tournament]);

  if (rounds.length === 0) {
    return (
      <div className="bracket-tree-shell bracket-tree-shell--empty">
        <div className="bracket-tree--empty">
          <Trophy size={28} />
          <strong>{bn ? "ব্র্যাকেট শীঘ্রই তৈরি হবে" : "Bracket coming soon"}</strong>
          <span>
            {bn
              ? "টুর্নামেন্ট শুরু হলে ব্র্যাকেট এখানে দেখা যাবে"
              : "The bracket appears when the tournament starts"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bracket-tree-shell">
      {compact ? (
        <BracketMobileList
          rounds={rounds}
          tournament={tournament}
          bn={bn}
          userId={userId}
          onOpenMatch={onOpenMatch}
        />
      ) : (
        <div
          className="bracket-tree-canvas"
          style={{
            width: Math.max(layout.width, 320),
            height: layout.height,
          }}
        >
          {layout.labels.map((label, col) => (
            <div
              className="bracket-tree__column-label"
              key={label + col}
              style={{
                left: slotLeftX(col),
                width: COL_WIDTH,
              }}
            >
              {label}
            </div>
          ))}

          <svg
            className="bracket-tree-canvas__lines"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.paths.map((path, index) => (
              <g key={index}>
                <path d={path} className="bracket-tree-line bracket-tree-line--glow" />
                <path d={path} className="bracket-tree-line" />
              </g>
            ))}
          </svg>

          {layout.slots.map((slot) => (
            <div
              key={slot.key}
              className="bracket-tree-canvas__slot"
              style={{
                left: slotLeftX(slot.col),
                top: LABEL_HEIGHT + (slot.rowStart - 1) * ROW_UNIT,
                width: COL_WIDTH,
                height: slot.rowSpan * ROW_UNIT,
              }}
            >
              <BracketBox
                slot={slot}
                tournament={tournament}
                bn={bn}
                userId={userId}
                onOpen={onOpenMatch}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
