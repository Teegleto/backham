import React, { useEffect, useMemo, useState } from "react";

/**
 * A fully self‑contained backgammon game with bot play and doubling cube.
 *
 * This version auto‑scales the game board to fill the available viewport
 * width or height (whichever is limiting) while preventing page scrolling.
 * The setup dialog and other modals are pinned to the top of the screen
 * rather than being vertically centered.
 */
export default function App() {
  // Base dimensions used for scaling. These values approximate the
  // intrinsic layout size of the board, sidebar and history combined.
  const BASE_WIDTH = 1150;
  const BASE_HEIGHT = 750;

  // Compute a scale factor that maintains the aspect ratio while fitting
  // within the viewport. Listen for resize events and update accordingly.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function updateScale() {
      const availW = window.innerWidth;
      const availH = window.innerHeight;
      const newScale = Math.min(availW / BASE_WIDTH, availH / BASE_HEIGHT);
      setScale(newScale);
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Initial board configuration: 24 points indexed 0–23. Positive numbers
  // represent white checkers; negative numbers represent black checkers.
  const START = useMemo(() => {
    const p = Array(24).fill(0);
    p[0] = 2;
    p[11] = 5;
    p[16] = 3;
    p[18] = 5;
    p[23] -= 2;
    p[12] -= 5;
    p[7] -= 3;
    p[5] -= 5;
    return p;
  }, []);

  // Game state hooks
  const [playerColor, setPlayerColor] = useState(1);
  const [botLevel, setBotLevel] = useState('normal');
  const [useCube, setUseCube] = useState(true);
  const [showStart, setShowStart] = useState(true);
  const [board, setBoard] = useState(START.slice());
  const [bar, setBar] = useState({ 1: 0, [-1]: 0 });
  const [off, setOff] = useState({ 1: 0, [-1]: 0 });
  const [turn, setTurn] = useState(1);
  const [dice, setDice] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rolled, setRolled] = useState(false);
  const [botRolled, setBotRolled] = useState(false);
  const [botActing, setBotActing] = useState(false);
  const [cubeValue, setCubeValue] = useState(1);
  const [cubeOwner, setCubeOwner] = useState(null);
  const [awaitCubeDecision, setAwaitCubeDecision] = useState(null);
  const [history, setHistory] = useState([]);
  const [rewind, setRewind] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState({ board: START.slice(), bar: { 1: 0, [-1]: 0 }, off: { 1: 0, [-1]: 0 } });
  const [botOfferedThisTurn, setBotOfferedThisTurn] = useState(false);
  const [winner, setWinner] = useState(null);

  const BOT_DELAY = 450; // ms delay for bot moves
  const liveIndex = history.length;
  const isLive = rewind === liveIndex;

  // The viewState object holds the board/bar/off state for the current
  // time position (live or rewound). When rewinding, we display a
  // snapshot from history rather than current state.
  const viewState = useMemo(() => {
    if (isLive) return { board, bar, off };
    if (rewind === 0) return initialSnapshot;
    const e = history[rewind - 1];
    return e ? e.after : initialSnapshot;
  }, [isLive, rewind, board, bar, off, initialSnapshot, history]);
  const rewindEntry = !isLive && rewind > 0 ? history[rewind - 1] : null;

  // Utility functions for game logic
  function other(p) { return p === 1 ? -1 : 1; }
  function roll() { return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]; }
  function pointBlocked(b, p, i) {
    if (i < 0 || i > 23) return false;
    const v = b[i];
    return p === 1 ? v <= -2 : v >= 2;
  }
  function allHome(b, p) {
    if (p === 1) {
      let s = 0;
      for (let i = 0; i < 18; i++) s += Math.max(0, b[i]);
      return s === 0;
    }
    let s = 0;
    for (let i = 6; i < 24; i++) s += Math.max(0, -b[i]);
    return s === 0;
  }
  function legalMovesForDie(b, p, br, d) {
    const ms = [];
    const step = (i, n) => (p === 1 ? i + n : i - n);
    const enter = n => (p === 1 ? n - 1 : 24 - n);
    // If there are checkers on the bar, you must enter them first
    if ((br[p] || 0) > 0) {
      const to = enter(d);
      if (!pointBlocked(b, p, to)) ms.push({ from: 'BAR', to });
      return ms;
    }
    // Otherwise, iterate over board points
    for (let i = 0; i < 24; i++) {
      const v = b[i];
      if (!(p === 1 ? v > 0 : v < 0)) continue;
      let to = step(i, d);
      // Bearing off rules for white
      if (p === 1 && to > 23) {
        if (allHome(b, 1)) {
          let behind = 0;
          for (let j = 18; j < i; j++) behind += Math.max(0, b[j]);
          const exact = 24 - i;
          if (d === exact || (d > exact && behind === 0)) ms.push({ from: i, to: 24 });
        }
        continue;
      }
      // Bearing off rules for black
      if (p === -1 && to < 0) {
        if (allHome(b, -1)) {
          let ahead = 0;
          for (let j = 5; j > i; j--) ahead += Math.max(0, -b[j]);
          const exact = i + 1;
          if (d === exact || (d > exact && ahead === 0)) ms.push({ from: i, to: -1 });
        }
        continue;
      }
      if (!pointBlocked(b, p, to)) ms.push({ from: i, to });
    }
    return ms;
  }
  function dieUsedForMove(p, mv) {
    if (mv.from === 'BAR') return p === 1 ? mv.to + 1 : 24 - mv.to;
    if (mv.to === 24) return 24 - mv.from;
    if (mv.to === -1) return mv.from + 1;
    return p === 1 ? mv.to - mv.from : mv.from - mv.to;
  }
  function applyMove(b, br, p, mv) {
    const nb = b.slice();
    const nbar = { ...br };
    if (mv.from === 'BAR') {
      nbar[p] = (nbar[p] || 0) - 1;
    } else {
      nb[mv.from] += p === 1 ? -1 : 1;
    }
    // Bearing off move
    if (mv.to === 24 || mv.to === -1) {
      return { b: nb, bar: nbar };
    }
    // Hitting an opponent's single checker
    const v = nb[mv.to];
    if ((p === 1 && v === -1) || (p === -1 && v === 1)) {
      nb[mv.to] = 0;
      nbar[other(p)] = (nbar[other(p)] || 0) + 1;
    }
    nb[mv.to] += p === 1 ? 1 : -1;
    return { b: nb, bar: nbar };
  }
  function listAllLegal(b, p, br, ds) {
    const out = [];
    const seen = new Set();
    for (const d of ds) {
      const ms = legalMovesForDie(b, p, br, d);
      for (const m of ms) {
        const key = `${m.from}->${m.to}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(m);
        }
      }
    }
    return out;
  }

  // Determine the board orientation based on the player's color. White
  // starts at lower right and moves counterclockwise; black does the
  // opposite. This mapping arranges the points into top-left, top-right,
  // bottom-left and bottom-right groups for rendering.
  const orient = useMemo(() => {
    if (playerColor === 1) {
      return { TL: [11, 10, 9, 8, 7, 6], TR: [5, 4, 3, 2, 1, 0], BL: [12, 13, 14, 15, 16, 17], BR: [18, 19, 20, 21, 22, 23] };
    } else {
      return { TL: [12, 13, 14, 15, 16, 17], TR: [18, 19, 20, 21, 22, 23], BL: [11, 10, 9, 8, 7, 6], BR: [5, 4, 3, 2, 1, 0] };
    }
  }, [playerColor]);

  // Determine if the current player can roll dice
  const canRoll = !showStart && isLive && dice.length === 0 && turn === playerColor && awaitCubeDecision == null && !winner;

  // Append a history entry (called after making a move)
  function pushHistory(entry) {
    setHistory(h => [...h, entry]);
    setRewind(h => h + 1);
  }

  // Handle rolling dice for the human player
  function startRoll() {
    if (!canRoll) return;
    const [d1, d2] = roll();
    setDice(d1 === d2 ? [d1, d1, d1, d1] : [d1, d2]);
    setRolled(true);
    if ((bar[playerColor] || 0) > 0) setSelected('BAR');
  }
  // Consume a die after a move
  function consumeDie(val) {
    setDice(ds => {
      const i = ds.indexOf(val);
      const a = ds.slice();
      if (i >= 0) a.splice(i, 1);
      else a.shift();
      return a;
    });
  }

  // Determine whether a checker at a given point can drop/move onto another point
  function canDropPoint(i) {
    return isLive && selected != null && listAllLegal(board, turn, bar, dice).some(m => m.from === selected && m.to === i);
  }
  function canSelectPoint(i) {
    if (!isLive || dice.length === 0) return false;
    const owns = turn === 1 ? board[i] > 0 : board[i] < 0;
    return owns || listAllLegal(board, turn, bar, dice).some(m => m.from === i);
  }
  function onSelect(src) {
    if (!isLive || showStart || winner) return;
    if (turn !== playerColor || dice.length === 0) return;
    setSelected(src);
  }
  // Handle a move from selected to a destination point
  function onMove(dst) {
    if (!isLive || showStart || winner) return;
    if (turn !== playerColor || dice.length === 0 || selected == null) return;
    const leg = listAllLegal(board, turn, bar, dice);
    const mv = leg.find(m => m.from === selected && m.to === dst);
    if (!mv) return;
    const used = dieUsedForMove(turn, mv);
    const before = { board: board.slice(), bar: { ...bar }, off: { ...off } };
    const { b, bar: br } = applyMove(board, bar, turn, mv);
    let offNext = off;
    if (mv.to === 24 || mv.to === -1) offNext = { ...off, [turn]: (off[turn] || 0) + 1 };
    setBoard(b);
    setBar(br);
    setOff(offNext);
    setSelected(null);
    consumeDie(used);
    const after = { board: b.slice(), bar: { ...br }, off: { ...offNext } };
    pushHistory({ seq: history.length + 1, player: turn, move: mv, usedDie: used, diceBefore: dice.slice(), diceAfter: (() => { const i = dice.indexOf(used); const a = dice.slice(); if (i >= 0) a.splice(i, 1); else a.shift(); return a; })(), before, after });
  }
  // Compute a potential bear off move for the selected checker
  function bearOffMoveForSelected() {
    if (selected == null) return null;
    for (const d of dice) {
      const ms = legalMovesForDie(board, turn, bar, d).filter(m => m.from === selected && (m.to === 24 || m.to === -1));
      if (ms.length) return { mv: ms[0], die: d };
    }
    return null;
  }
  const canBearOffSelected = isLive && turn === playerColor && dice.length > 0 && !!bearOffMoveForSelected();
  function doBearOff() {
    const f = bearOffMoveForSelected();
    if (!f) return;
    const { mv, die } = f;
    const before = { board: board.slice(), bar: { ...bar }, off: { ...off } };
    const res = applyMove(board, bar, turn, mv);
    const offNext = { ...off, [turn]: (off[turn] || 0) + 1 };
    const after = { board: res.b.slice(), bar: { ...res.bar }, off: offNext };
    setBoard(res.b);
    setBar(res.bar);
    setOff(offNext);
    setSelected(null);
    setDice(ds => { const i = ds.indexOf(die); const a = ds.slice(); if (i >= 0) a.splice(i, 1); else a.shift(); return a; });
    pushHistory({ seq: history.length + 1, player: turn, move: mv, usedDie: die, diceBefore: dice.slice(), diceAfter: (() => { const i = dice.indexOf(die); const a = dice.slice(); if (i >= 0) a.splice(i, 1); else a.shift(); return a; })(), before, after });
  }

  // Watch for transitions: switch turns, handle no moves, end game etc.
  useEffect(() => {
    if (showStart || winner) return;
    if (!isLive) return;
    // Human's turn; if rolled and out of dice, pass turn
    if (turn === playerColor) {
      if (rolled && dice.length === 0) {
        setRolled(false);
        setTurn(other(turn));
      } else if (dice.length > 0) {
        const leg = listAllLegal(board, turn, bar, dice);
        if (leg.length === 0) {
          setDice([]);
          setSelected(null);
          setTurn(other(turn));
        }
      }
      return;
    }
  }, [showStart, isLive, turn, playerColor, rolled, dice, board, bar, winner]);

  // Setup bot acting state based on whose turn it is
  useEffect(() => {
    if (turn === other(playerColor)) {
      setBotRolled(false);
      setBotActing(true);
      setBotOfferedThisTurn(false);
    } else {
      setBotActing(false);
    }
  }, [turn, playerColor]);

  // Main bot logic: roll dice, move, offer doubles etc.
  useEffect(() => {
    if (showStart || winner) return;
    if (!isLive) return;
    if (turn !== other(playerColor)) return;
    if (!botActing) return;
    if (awaitCubeDecision) return;

    // Possibly offer to double
    if (useCube && !botOfferedThisTurn && (!cubeOwner || cubeOwner === turn)) {
      const p = botLevel === 'weak' ? 0.15 : botLevel === 'strong' ? 0.45 : 0.25;
      if (Math.random() < p) {
        setAwaitCubeDecision({ type: 'botOffer', value: cubeValue * 2 });
        setBotOfferedThisTurn(true);
        return;
      }
      setBotOfferedThisTurn(true);
    }
    // Roll dice if necessary
    if (dice.length === 0) {
      if (!botRolled) {
        const [d1, d2] = roll();
        setDice(d1 === d2 ? [d1, d1, d1, d1] : [d1, d2]);
        setBotRolled(true);
      }
      return;
    }
    // Evaluate possible moves for the first die
    const d = dice[0];
    const options = legalMovesForDie(board, turn, bar, d);
    if (options.length === 0) {
      // No legal moves with this die; drop it
      setDice(ds => ds.slice(1));
      return;
    }
    // Choose a move based on bot level
    const pick = level => {
      if (level === 'weak') return options[0];
      if (level === 'strong') {
        let best = options[0], bestScore = -1e9;
        for (const m of options) {
          const sim = applyMove(board, bar, turn, m);
          const score = (sim.b[m.to] || 0) * (turn === 1 ? 1 : -1) - (sim.bar[other(turn)] || 0) * 2;
          if (score > bestScore) {
            best = m;
            bestScore = score;
          }
        }
        return best;
      }
      // Normal bot: random
      return options[Math.floor(Math.random() * options.length)];
    };
    const mv = pick(botLevel);
    const used = dieUsedForMove(turn, mv);
    const before = { board: board.slice(), bar: { ...bar }, off: { ...off } };
    const res = applyMove(board, bar, turn, mv);
    let offNext = off;
    if (mv.to === 24 || mv.to === -1) offNext = { ...off, [turn]: (off[turn] || 0) + 1 };
    const after = { board: res.b.slice(), bar: { ...res.bar }, off: { ...offNext } };
    const t = setTimeout(() => {
      setBoard(res.b);
      setBar(res.bar);
      setOff(offNext);
      setDice(ds => {
        const i = ds.indexOf(d);
        const a = ds.slice();
        if (i >= 0) a.splice(i, 1);
        return a;
      });
      pushHistory({ seq: history.length + 1, player: turn, move: mv, usedDie: used, diceBefore: [...dice], diceAfter: (() => { const i = dice.indexOf(d); const a = dice.slice(); if (i >= 0) a.splice(i, 1); return a; })(), before, after });
    }, BOT_DELAY);
    return () => clearTimeout(t);
  }, [showStart, isLive, turn, playerColor, botLevel, dice, board, bar, off, awaitCubeDecision, botRolled, botActing, botOfferedThisTurn, cubeOwner, useCube, cubeValue, winner]);

  // Handle end of bot turn when no dice remain
  useEffect(() => {
    if (showStart || winner) return;
    if (!isLive) return;
    if (turn === other(playerColor) && dice.length === 0 && botActing && !awaitCubeDecision) {
      const t = setTimeout(() => {
        setBotActing(false);
        setTurn(playerColor);
      }, 260);
      return () => clearTimeout(t);
    }
  }, [showStart, isLive, turn, playerColor, dice.length, botActing, awaitCubeDecision, winner]);

  // Check for win condition (all 15 checkers borne off)
  useEffect(() => {
    if (!isLive) return;
    if (off[1] >= 15 || off[-1] >= 15) {
      setDice([]);
      setSelected(null);
      setAwaitCubeDecision(null);
      setWinner(off[1] >= 15 ? 1 : -1);
    }
  }, [isLive, off]);

  // Restart the game with initial settings
  function NewGame() {
    setBoard(START.slice());
    setBar({ 1: 0, [-1]: 0 });
    setOff({ 1: 0, [-1]: 0 });
    setDice([]);
    setSelected(null);
    setTurn(playerColor);
    setHistory([]);
    setRewind(0);
    setInitialSnapshot({ board: START.slice(), bar: { 1: 0, [-1]: 0 }, off: { 1: 0, [-1]: 0 } });
    setLastHighlight(null);
    setCubeValue(1);
    setCubeOwner(null);
    setAwaitCubeDecision(null);
    setRolled(false);
    setBotRolled(false);
    setBotActing(false);
    setBotOfferedThisTurn(false);
    setWinner(null);
  }

  // Last highlight state for rewinding (not rendered in this version but kept for completeness)
  const [lastHighlight, setLastHighlight] = useState(null);

  // Determine if the player may offer a double
  const playerCanOffer = useCube && isLive && !winner && turn === playerColor && !awaitCubeDecision && (!cubeOwner || cubeOwner === turn);

  /**
   * Triangle component draws a point on the board as an upward or downward
   * triangle. Alternating indices produce alternating colors for visual
   * clarity.
   */
  function Triangle({ up, idx }) {
    const light = "#E8D3B5";
    const dark = "#8B5E3C";
    const color = idx % 2 === 0 ? light : dark;
    const common = "w-12 h-16";
    const style = up
      ? { borderLeft: "20px solid transparent", borderRight: "20px solid transparent", borderBottom: `64px solid ${color}` }
      : { borderLeft: "20px solid transparent", borderRight: "20px solid transparent", borderTop: `64px solid ${color}` };
    return <div className={common} style={style} />;
  }

  /**
   * Checker component renders a single white or black checker with a small
   * shadow and border for readability.
   */
  function Checker({ color }) {
    return (
      <div className={`w-6 h-6 rounded-full shadow-sm ring-1 ${color === 'white' ? 'bg-white ring-neutral-300' : 'bg-neutral-900 ring-neutral-700'}`} />
    );
  }

  /**
   * Stack component draws a vertical stack of checkers. Up to five are
   * visible; additional checkers are indicated with a "+n" label. The
   * `up` flag controls whether the count label appears above or below.
   */
  function Stack({ n, color, up }) {
    const vis = Math.min(5, n);
    return (
      <div className="relative w-9" style={{ height: vis * 22 }}>
        {Array.from({ length: vis }).map((_, i) => (
          <div key={i} className="absolute" style={{ bottom: i * 20 }}>
            <Checker color={color} />
          </div>
        ))}
        {n > 5 && (
          <div className={`absolute text-xs font-semibold ${up ? 'bottom-full mb-1' : 'top-full mt-1'} left-1/2 -translate-x-1/2`}>
            +{n - 5}
          </div>
        )}
      </div>
    );
  }

  /**
   * Point component encapsulates a single point on the board. It handles
   * selection and move logic, draws the triangle background, and stacks of
   * checkers on top. When rewound, it highlights the origin and destination.
   */
  function Point({ i, up, idx }) {
    const v = viewState.board[i];
    const whites = Math.max(0, v);
    const blacks = Math.max(0, -v);
    const droppable = isLive && canDropPoint(i);
    const selectable = isLive && (canSelectPoint(i) || selected === i);
    const on = () => {
      if (!isLive || showStart || winner) return;
      if (droppable) return onMove(i);
      if (selectable) return onSelect(i);
      setSelected(null);
    };
    const showOrigin = !isLive && rewindEntry && rewindEntry.move.from === i;
    const showDest = !isLive && rewindEntry && rewindEntry.move.to === i;
    return (
      <div className={`relative flex-1 flex ${up ? 'flex-col' : 'flex-col-reverse'} items-center px-1`} onClick={on}>
        <div className={`relative w-12 h-16 cursor-pointer rounded-sm ${droppable ? 'ring-4 ring-emerald-400/80' : ''} ${selected === i ? 'ring-4 ring-sky-400/80' : ''}`}>
          <Triangle up={up} idx={idx} />
          {!isLive && showOrigin && <div className="absolute inset-0 ring-4 ring-purple-500 rounded-sm pointer-events-none" />}
          {!isLive && showDest && <div className="absolute inset-0 ring-4 ring-orange-400 rounded-sm pointer-events-none" />}
        </div>
        <div className={`absolute ${up ? 'top-0' : 'bottom-0'} w-full flex justify-center pointer-events-none`}>
          <Stack n={whites} color="white" up={up} />
          <Stack n={blacks} color="black" up={up} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f5efe6] relative">
      {/* Start game overlay */}
      {showStart && (
        <div className="fixed inset-x-0 top-0 bottom-auto bg-black/60 flex items-start justify-center pt-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-[min(92vw,420px)] space-y-3">
            <div className="text-lg font-semibold">Start Game</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPlayerColor(1)} className={`border rounded p-3 ${playerColor === 1 ? 'ring-2 ring-emerald-500' : ''}`}>Play White</button>
              <button onClick={() => setPlayerColor(-1)} className={`border rounded p-3 ${playerColor === -1 ? 'ring-2 ring-emerald-500' : ''}`}>Play Black</button>
            </div>
            <div>
              <div className="text-sm mb-1">Bot strength</div>
              <select className="w-full border rounded px-3 py-2" value={botLevel} onChange={e => setBotLevel(e.target.value)}>
                <option value="weak">Weak</option>
                <option value="normal">Normal</option>
                <option value="strong">Strong</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input id="cube" type="checkbox" checked={useCube} onChange={e => setUseCube(e.target.checked)} />
              <label htmlFor="cube" className="text-sm">Enable doubling cube</label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button className="border rounded px-3 py-2" onClick={() => { setShowStart(false); NewGame(); }}>Start</button>
            </div>
          </div>
        </div>
      )}
      {/* Bot offers doubling cube overlay */}
      {awaitCubeDecision && awaitCubeDecision.type === 'botOffer' && (
        <div className="fixed inset-x-0 top-0 bottom-auto bg-black/70 z-50 flex items-start justify-center pt-4">
          <div className="bg-white rounded-2xl p-6 w-[min(92vw,480px)]">
            <div className="text-lg font-semibold mb-3">Bot offers to double to {awaitCubeDecision.value}×</div>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-2 border rounded" onClick={() => { setCubeValue(v => v * 2); setCubeOwner(playerColor); setAwaitCubeDecision(null); }}>Accept</button>
              <button className="px-3 py-2 border rounded" onClick={() => { setAwaitCubeDecision(null); }}>Reject</button>
            </div>
          </div>
        </div>
      )}
      {/* Winner overlay */}
      {winner && (
        <div className="fixed inset-x-0 top-0 bottom-auto bg-black/70 z-50 flex items-start justify-center pt-4">
          <div className="bg-white rounded-2xl p-6 w-[min(92vw,420px)] space-y-3 text-center">
            <div className="text-lg font-semibold">{winner === 1 ? 'White' : 'Black'} wins!</div>
            <div className="flex gap-3 justify-center">
              <button className="px-3 py-2 border rounded" onClick={() => { setShowStart(true); }}>Replay</button>
              <button className="px-3 py-2 border rounded" onClick={() => { setWinner(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Main content scaled to fit viewport */}
      <div className="w-full h-full flex justify-center items-start overflow-hidden">
        <div style={{ width: `${BASE_WIDTH}px`, height: `${BASE_HEIGHT}px`, transform: `scale(${scale})`, transformOrigin: 'top center' }} className="pointer-events-auto">
          {/* Controls row */}
          <div className="flex gap-3 items-center mb-3 relative z-20">
            <button onClick={() => { setShowStart(true); }} className="px-3 py-2 rounded border">Home</button>
            <button onClick={startRoll} disabled={!canRoll} className="px-3 py-2 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40">🎲 Roll Dice</button>
            <button onClick={NewGame} className="px-3 py-2 rounded border">Restart</button>
            <div className="ml-auto text-sm">Turn: {turn === playerColor ? 'You' : 'Bot'}</div>
            <div className="text-sm">Dice: {dice.length ? dice.join(' • ') : '—'}</div>
          </div>
          {/* Board and sidebar */}
          <div className="flex flex-col lg:flex-row items-start gap-4">
            <div className="bg-[#d5b894] rounded-2xl p-5 shadow-inner overflow-visible relative z-0">
              {/* Top half of board */}
              <div className="flex mb-20">
                <div className="flex flex-1 gap-2 pr-6 border-r-8" style={{ borderColor: '#b88a5a' }}>
                  {orient.TL.map((i, idx) => (<Point key={i} i={i} up={true} idx={idx} />))}
                </div>
                {/* Bar */}
                <div
                  className={`${(isLive && dice.length > 0 && (bar[turn] || 0) > 0 && selected === 'BAR') ? 'ring-4 ring-sky-400/70' : ''} w-24 mx-6 rounded-md flex flex-col items-center justify-between py-2`}
                  style={{ background: '#caa97a' }}
                  onClick={() => { if (isLive && turn === playerColor && dice.length > 0 && (bar[playerColor] || 0) > 0) setSelected('BAR'); }}
                >
                  <div className="text-[10px] text-neutral-800">BAR</div>
                  <div className="flex flex-col items-center">{Array(Math.min(6, viewState.bar[1] || 0)).fill(0).map((_, i) => (<div key={`wb${i}`} className="mb-1"><Checker color="white" /></div>))}</div>
                  <div className="flex flex-col items-center">{Array(Math.min(6, viewState.bar[-1] || 0)).fill(0).map((_, i) => (<div key={`bb${i}`} className="mb-1"><Checker color="black" /></div>))}</div>
                </div>
                <div className="flex flex-1 gap-2 pl-6 border-l-8" style={{ borderColor: '#b88a5a' }}>
                  {orient.TR.map((i, idx) => (<Point key={i} i={i} up={true} idx={idx} />))}
                </div>
              </div>
              {/* Bottom half of board */}
              <div className="flex mt-20">
                <div className="flex flex-1 gap-2 pr-6 border-r-8" style={{ borderColor: '#b88a5a' }}>
                  {orient.BL.map((i, idx) => (<Point key={i} i={i} up={false} idx={idx} />))}
                </div>
                <div className="w-24 mx-6 rounded-md flex items-center justify-center text-[11px] text-neutral-900 select-none" style={{ background: '#caa97a' }}>
                  Dice: {dice.length ? dice.join(' • ') : '—'}
                </div>
                <div className="flex flex-1 gap-2 pl-6 border-l-8" style={{ borderColor: '#b88a5a' }}>
                  {orient.BR.map((i, idx) => (<Point key={i} i={i} up={false} idx={idx} />))}
                </div>
              </div>
            </div>
            {/* Sidebar */}
            <div className="w-full lg:w-56 shrink-0 space-y-3">
              <div className="bg-white/80 rounded-xl p-3 border">
                <div className="text-xs font-semibold mb-2">Borne Off</div>
                <div className="text-xs mb-2">White: <b>{viewState.off[1] || 0}</b> / 15</div>
                <div className="text-xs">Black: <b>{viewState.off[-1] || 0}</b> / 15</div>
              </div>
              {useCube && (
                <div className="bg-white/80 rounded-xl p-3 border">
                  <div className="text-xs font-semibold mb-2">Doubling Cube</div>
                  <div className="text-lg font-bold">{cubeValue}×</div>
                  <button
                    disabled={!playerCanOffer}
                    onClick={() => {
                      if (!playerCanOffer) return;
                      setAwaitCubeDecision({ type: 'playerOffer', value: cubeValue * 2 });
                      setTimeout(() => {
                        const accept = (botLevel === 'weak' ? Math.random() > 0.6 : botLevel === 'strong' ? Math.random() > 0.25 : Math.random() > 0.45);
                        if (accept) { setCubeValue(v => v * 2); setCubeOwner(other(turn)); }
                        setAwaitCubeDecision(null);
                      }, 600);
                    }}
                    className="mt-2 px-3 py-1 border rounded disabled:opacity-40"
                  >
                    Offer Double
                  </button>
                </div>
              )}
              <div className="bg-white/80 rounded-xl p-3 border">
                <div className="text-xs font-semibold mb-2">Bear Off</div>
                <button disabled={!canBearOffSelected} onClick={doBearOff} className="px-3 py-1 border rounded disabled:opacity-40">Bear off selected</button>
              </div>
            </div>
          </div>
          {/* History */}
          <div className="mt-6 bg-white/80 rounded-xl p-3 border">
            <div className="flex items-center gap-3">
              <div className="text-xs w-20 text-right">History</div>
              <input type="range" min={0} max={liveIndex} value={rewind} onChange={e => setRewind(parseInt(e.target.value, 10))} className="w-full" />
              <div className="text-xs w-20">{isLive ? 'Live' : `${rewind}/${liveIndex}`}</div>
            </div>
            {!isLive && rewindEntry && (
              <div className="mt-2 text-xs">
                <span className="font-semibold">{rewindEntry.player === 1 ? 'White' : 'Black'}</span> moved {rewindEntry.usedDie} • Rolled {rewindEntry.diceBefore.join('•')}
              </div>
            )}
            {!isLive && <div className="mt-1 text-[11px] text-rose-700">Gameplay disabled while rewound. Drag to the end to resume.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
