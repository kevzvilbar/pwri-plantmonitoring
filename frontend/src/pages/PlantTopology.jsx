import { useState, useEffect, useRef, useCallback } from "react";

// ─── Seed data based on PWRI project schema ──────────────────────────────────
const INITIAL_TOPOLOGY = {
  plants: [
    { id: "plant-umapad", name: "Umapad" },
    { id: "plant-banilad", name: "Banilad" },
  ],
  wells: [
    { id: "well-u1", plantId: "plant-umapad", name: "Well 1", status: "Active" },
    { id: "well-u2", plantId: "plant-umapad", name: "Well 2", status: "Active" },
    { id: "well-u3", plantId: "plant-umapad", name: "Well 3", status: "Active" },
    { id: "well-b1", plantId: "plant-banilad", name: "Well 1", status: "Active" },
    { id: "well-b2", plantId: "plant-banilad", name: "Well 2", status: "Inactive" },
  ],
  rawMeters: [
    { id: "rm-u1", plantId: "plant-umapad", wellId: "well-u1", name: "Raw W1" },
    { id: "rm-u2", plantId: "plant-umapad", wellId: "well-u2", name: "Raw W2" },
    { id: "rm-u3", plantId: "plant-umapad", wellId: "well-u3", name: "Raw W3" },
    { id: "rm-b1", plantId: "plant-banilad", wellId: "well-b1", name: "Raw W1" },
  ],
  pretreatments: [
    { id: "pt-u1", plantId: "plant-umapad", name: "Pre-treatment" },
    { id: "pt-b1", plantId: "plant-banilad", name: "Pre-treatment" },
  ],
  feedMeters: [
    { id: "fm-u1", plantId: "plant-umapad", name: "Feed Meter" },
    { id: "fm-b1", plantId: "plant-banilad", name: "Feed Meter" },
  ],
  roTrains: [
    { id: "ro-u1", plantId: "plant-umapad", name: "RO Train 1", status: "Active" },
    { id: "ro-u2", plantId: "plant-umapad", name: "RO Train 2", status: "Active" },
    { id: "ro-b1", plantId: "plant-banilad", name: "RO Train 1", status: "Active" },
  ],
  permeateMeters: [
    { id: "pm-u1", plantId: "plant-umapad", roId: "ro-u1", name: "Permeate M1" },
    { id: "pm-u2", plantId: "plant-umapad", roId: "ro-u2", name: "Permeate M2" },
    { id: "pm-b1", plantId: "plant-banilad", roId: "ro-b1", name: "Permeate M1" },
  ],
  rejectMeters: [
    { id: "rjm-u1", plantId: "plant-umapad", roId: "ro-u1", name: "Reject M1" },
    { id: "rjm-u2", plantId: "plant-umapad", roId: "ro-u2", name: "Reject M2" },
  ],
  bulkMeters: [
    { id: "bm-u1", plantId: "plant-umapad", name: "Bulk/Mother M1" },
    { id: "bm-u2", plantId: "plant-umapad", name: "Bulk/Mother M2" },
    { id: "bm-b1", plantId: "plant-banilad", name: "Bulk/Mother M1" },
  ],
  locators: [
    { id: "loc-u1", plantId: "plant-umapad", name: "MCWD - M1" },
    { id: "loc-u2", plantId: "plant-umapad", name: "MCWD - M2" },
    { id: "loc-u3", plantId: "plant-umapad", name: "Subdivision A" },
    { id: "loc-u4", plantId: "plant-umapad", name: "Commercial B" },
    { id: "loc-b1", plantId: "plant-banilad", name: "MCWD - B1" },
    { id: "loc-b2", plantId: "plant-banilad", name: "MCWD - B2" },
  ],
  // Connections: which permeate meters feed which bulk meters
  permateToBulk: [
    { from: "pm-u1", to: "bm-u1" },
    { from: "pm-u2", to: "bm-u1" },
    { from: "pm-b1", to: "bm-b1" },
  ],
  // Connections: which bulk meters supply which locators
  bulkToLocator: [
    { from: "bm-u1", to: "loc-u1" },
    { from: "bm-u1", to: "loc-u2" },
    { from: "bm-u2", to: "loc-u3" },
    { from: "bm-u2", to: "loc-u4" },
    { from: "bm-b1", to: "loc-b1" },
    { from: "bm-b1", to: "loc-b2" },
  ],
  // Wells → RO trains (wells can feed multiple trains via pretreatment)
  wellsToRO: [
    { from: "well-u1", to: "ro-u1" },
    { from: "well-u2", to: "ro-u1" },
    { from: "well-u2", to: "ro-u2" },
    { from: "well-u3", to: "ro-u2" },
    { from: "well-b1", to: "ro-b1" },
  ],
};

// ─── Color palette ────────────────────────────────────────────────────────────
const COLORS = {
  well:       { bg: "#0f3460", border: "#1a5276", text: "#7ec8e3", accent: "#3498db" },
  rawMeter:   { bg: "#1a237e", border: "#283593", text: "#90caf9", accent: "#5c6bc0" },
  pretreat:   { bg: "#1b5e20", border: "#2e7d32", text: "#a5d6a7", accent: "#66bb6a" },
  feedMeter:  { bg: "#004d40", border: "#00695c", text: "#80cbc4", accent: "#26a69a" },
  roTrain:    { bg: "#4a148c", border: "#6a1b9a", text: "#ce93d8", accent: "#ab47bc" },
  permeate:   { bg: "#006064", border: "#00838f", text: "#80deea", accent: "#26c6da" },
  reject:     { bg: "#b71c1c", border: "#c62828", text: "#ef9a9a", accent: "#ef5350" },
  bulk:       { bg: "#e65100", border: "#ef6c00", text: "#ffcc80", accent: "#ffa726" },
  locator:    { bg: "#263238", border: "#37474f", text: "#b0bec5", accent: "#78909c" },
};

const NODE_TYPES = {
  well: "Well",
  rawMeter: "Raw Meter",
  pretreat: "Pre-treatment",
  feedMeter: "Feed Meter",
  roTrain: "RO Train",
  permeate: "Permeate Meter",
  reject: "Reject Meter",
  bulk: "Bulk/Mother Meter",
  locator: "Locator",
};

// ─── Main component ───────────────────────────────────────────────────────────
export default function PlantTopology() {
  const [topology, setTopology] = useState(INITIAL_TOPOLOGY);
  const [selectedPlant, setSelectedPlant] = useState("plant-umapad");
  const [isAdmin, setIsAdmin] = useState(false);
  const [editMode, setEditMode] = useState(null); // null | 'connect' | 'disconnect'
  const [pendingFrom, setPendingFrom] = useState(null); // { id, type }
  const [hoveredNode, setHoveredNode] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const svgRef = useRef(null);
  const nodeRefs = useRef({});

  // Load from storage
  useEffect(() => {
    const tryLoad = async () => {
      try {
        const result = await window.storage.get("pwri-topology");
        if (result?.value) {
          setTopology(JSON.parse(result.value));
        }
      } catch (_) {}
    };
    tryLoad();
  }, []);

  // Save to storage
  const saveTopology = useCallback(async (topo) => {
    try {
      await window.storage.set("pwri-topology", JSON.stringify(topo));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (_) {}
  }, []);

  const plant = topology.plants.find((p) => p.id === selectedPlant);

  // Filter entities by plant
  const wells        = topology.wells.filter((w) => w.plantId === selectedPlant);
  const rawMeters    = topology.rawMeters.filter((m) => m.plantId === selectedPlant);
  const pretreat     = topology.pretreatments.filter((p) => p.plantId === selectedPlant);
  const feedMeters   = topology.feedMeters.filter((f) => f.plantId === selectedPlant);
  const roTrains     = topology.roTrains.filter((r) => r.plantId === selectedPlant);
  const permMeters   = topology.permeateMeters.filter((m) => m.plantId === selectedPlant);
  const rejMeters    = topology.rejectMeters.filter((m) => m.plantId === selectedPlant);
  const bulkMeters   = topology.bulkMeters.filter((m) => m.plantId === selectedPlant);
  const locators     = topology.locators.filter((l) => l.plantId === selectedPlant);
  const wellToRO     = topology.wellsToRO;
  const permToBulk   = topology.permateToBulk;
  const bulkToLoc    = topology.bulkToLocator;

  // ── Layout: 8 columns left→right ──────────────────────────────────────────
  const COLS = {
    well: 60,
    rawMeter: 195,
    pretreat: 320,
    feedMeter: 435,
    roTrain: 550,
    permeate: 665,
    reject: 665,
    bulk: 790,
    locator: 920,
  };
  const NODE_W = 108;
  const NODE_H = 44;
  const ROW_GAP = 58;
  const START_Y = 40;

  function nodeY(items, index) {
    return START_Y + index * ROW_GAP;
  }

  function nodeCenter(items, index) {
    const x = items; // x passed as first arg when it's a number
    const y = nodeY(null, index);
    return { x: x + NODE_W / 2, y: y + NODE_H / 2 };
  }

  // Build node position map
  const positions = {};
  wells.forEach((w, i) => { positions[w.id] = { x: COLS.well, y: nodeY(null, i) }; });
  rawMeters.forEach((m, i) => { positions[m.id] = { x: COLS.rawMeter, y: nodeY(null, i) }; });
  pretreat.forEach((p, i) => { positions[p.id] = { x: COLS.pretreat, y: nodeY(null, i) }; });
  feedMeters.forEach((f, i) => { positions[f.id] = { x: COLS.feedMeter, y: nodeY(null, i) }; });
  roTrains.forEach((r, i) => { positions[r.id] = { x: COLS.roTrain, y: nodeY(null, i) }; });
  permMeters.forEach((m, i) => { positions[m.id] = { x: COLS.permeate, y: nodeY(null, i) }; });
  rejMeters.forEach((m, i) => { positions[m.id] = { x: COLS.reject, y: nodeY(null, permMeters.length + i) }; });
  bulkMeters.forEach((m, i) => { positions[m.id] = { x: COLS.bulk, y: nodeY(null, i) }; });
  locators.forEach((l, i) => { positions[l.id] = { x: COLS.locator, y: nodeY(null, i) }; });

  const SVG_H = Math.max(
    wells.length, rawMeters.length, pretreat.length,
    roTrains.length, permMeters.length + rejMeters.length,
    bulkMeters.length, locators.length
  ) * ROW_GAP + START_Y + NODE_H + 20;

  // ── Connection helpers ─────────────────────────────────────────────────────
  function getConnectable(nodeId, nodeType) {
    // Returns which edge types this node can connect to
    const map = {
      well: ["roTrain"],
      roTrain: ["well"],
      permeate: ["bulk"],
      bulk: ["permeate", "locator"],
      locator: ["bulk"],
    };
    return map[nodeType] || [];
  }

  function handleNodeClick(id, type) {
    if (!isAdmin || !editMode) return;
    if (!pendingFrom) {
      setPendingFrom({ id, type });
      return;
    }
    if (pendingFrom.id === id) {
      setPendingFrom(null);
      return;
    }
    // Try to make/break connection
    const fromType = pendingFrom.type;
    const toType = type;
    const newTopo = { ...topology };

    if (editMode === "connect") {
      if ((fromType === "well" && toType === "roTrain") || (fromType === "roTrain" && toType === "well")) {
        const w = fromType === "well" ? pendingFrom.id : id;
        const ro = fromType === "roTrain" ? pendingFrom.id : id;
        const exists = newTopo.wellsToRO.some((c) => c.from === w && c.to === ro);
        if (!exists) {
          newTopo.wellsToRO = [...newTopo.wellsToRO, { from: w, to: ro }];
        }
      } else if ((fromType === "permeate" && toType === "bulk") || (fromType === "bulk" && toType === "permeate")) {
        const pm = fromType === "permeate" ? pendingFrom.id : id;
        const bm = fromType === "bulk" ? pendingFrom.id : id;
        const exists = newTopo.permateToBulk.some((c) => c.from === pm && c.to === bm);
        if (!exists) {
          newTopo.permateToBulk = [...newTopo.permateToBulk, { from: pm, to: bm }];
        }
      } else if ((fromType === "bulk" && toType === "locator") || (fromType === "locator" && toType === "bulk")) {
        const bm = fromType === "bulk" ? pendingFrom.id : id;
        const loc = fromType === "locator" ? pendingFrom.id : id;
        const exists = newTopo.bulkToLocator.some((c) => c.from === bm && c.to === loc);
        if (!exists) {
          newTopo.bulkToLocator = [...newTopo.bulkToLocator, { from: bm, to: loc }];
        }
      }
    } else if (editMode === "disconnect") {
      if ((fromType === "well" && toType === "roTrain") || (fromType === "roTrain" && toType === "well")) {
        const w = fromType === "well" ? pendingFrom.id : id;
        const ro = fromType === "roTrain" ? pendingFrom.id : id;
        newTopo.wellsToRO = newTopo.wellsToRO.filter((c) => !(c.from === w && c.to === ro));
      } else if ((fromType === "permeate" && toType === "bulk") || (fromType === "bulk" && toType === "permeate")) {
        const pm = fromType === "permeate" ? pendingFrom.id : id;
        const bm = fromType === "bulk" ? pendingFrom.id : id;
        newTopo.permateToBulk = newTopo.permateToBulk.filter((c) => !(c.from === pm && c.to === bm));
      } else if ((fromType === "bulk" && toType === "locator") || (fromType === "locator" && toType === "bulk")) {
        const bm = fromType === "bulk" ? pendingFrom.id : id;
        const loc = fromType === "locator" ? pendingFrom.id : id;
        newTopo.bulkToLocator = newTopo.bulkToLocator.filter((c) => !(c.from === bm && c.to === loc));
      }
    }

    setTopology(newTopo);
    saveTopology(newTopo);
    setPendingFrom(null);
  }

  // ── Draw a curved SVG path between two nodes ───────────────────────────────
  function drawPath(fromId, toId, color = "#4a5568", dash = false) {
    const f = positions[fromId];
    const t = positions[toId];
    if (!f || !t) return null;
    const x1 = f.x + NODE_W;
    const y1 = f.y + NODE_H / 2;
    const x2 = t.x;
    const y2 = t.y + NODE_H / 2;
    const cx = (x1 + x2) / 2;
    const d = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
    return (
      <path
        key={`${fromId}-${toId}`}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dash ? "5,3" : undefined}
        opacity={0.7}
        markerEnd="url(#arrow)"
      />
    );
  }

  // ── Node renderer ──────────────────────────────────────────────────────────
  function renderNode(id, type, label, x, y, status) {
    const c = COLORS[type] || COLORS.locator;
    const isPending = pendingFrom?.id === id;
    const isHovered = hoveredNode === id;
    const isClickable = isAdmin && editMode;
    const isInactive = status === "Inactive";

    return (
      <g
        key={id}
        transform={`translate(${x},${y})`}
        style={{ cursor: isClickable ? "pointer" : "default" }}
        onClick={() => handleNodeClick(id, type)}
        onMouseEnter={() => setHoveredNode(id)}
        onMouseLeave={() => setHoveredNode(null)}
      >
        {/* Glow effect when pending/hovered */}
        {(isPending || (isHovered && isClickable)) && (
          <rect
            x={-3} y={-3}
            width={NODE_W + 6} height={NODE_H + 6}
            rx={8}
            fill="none"
            stroke={isPending ? "#f6e05e" : c.accent}
            strokeWidth={2}
            opacity={0.9}
          />
        )}
        {/* Node body */}
        <rect
          width={NODE_W} height={NODE_H}
          rx={6}
          fill={isInactive ? "#1a1a2e" : c.bg}
          stroke={isPending ? "#f6e05e" : c.border}
          strokeWidth={isPending ? 2 : 1}
          opacity={isInactive ? 0.5 : 1}
        />
        {/* Type label at top */}
        <text
          x={NODE_W / 2} y={14}
          textAnchor="middle"
          fill={c.accent}
          fontSize={8}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
          opacity={0.85}
        >
          {NODE_TYPES[type]?.toUpperCase()}
        </text>
        {/* Name */}
        <text
          x={NODE_W / 2} y={30}
          textAnchor="middle"
          fill={isInactive ? "#4a5568" : c.text}
          fontSize={11}
          fontFamily="'IBM Plex Sans', sans-serif"
          fontWeight={500}
        >
          {label.length > 13 ? label.slice(0, 12) + "…" : label}
        </text>
        {/* Status dot */}
        {status && (
          <circle
            cx={NODE_W - 8} cy={8}
            r={3}
            fill={status === "Active" ? "#48bb78" : "#e53e3e"}
          />
        )}
      </g>
    );
  }

  // ── Build all edges ────────────────────────────────────────────────────────
  function buildEdges() {
    const edges = [];

    // Well → Raw Meter (always 1:1)
    rawMeters.forEach((rm) => {
      const w = wells.find((w) => w.id === rm.wellId);
      if (w && positions[w.id] && positions[rm.id]) {
        edges.push(drawPath(w.id, rm.id, COLORS.rawMeter.accent));
      }
    });

    // Raw Meter → Pre-treatment (all raw meters in plant → plant's pretreatment)
    const pt = pretreat[0];
    if (pt) {
      rawMeters.forEach((rm) => {
        edges.push(drawPath(rm.id, pt.id, COLORS.pretreat.accent));
      });
      // Pretreatment → Feed Meter
      const fm = feedMeters[0];
      if (fm) {
        edges.push(drawPath(pt.id, fm.id, COLORS.feedMeter.accent));
        // Feed Meter → RO Trains (based on wellsToRO mapping, but visual goes feed→all trains)
        roTrains.forEach((ro) => {
          edges.push(drawPath(fm.id, ro.id, COLORS.roTrain.accent));
        });
      }
    }

    // RO Train → Permeate & Reject meters
    permMeters.forEach((pm) => {
      const ro = roTrains.find((r) => r.id === pm.roId);
      if (ro) edges.push(drawPath(ro.id, pm.id, COLORS.permeate.accent));
    });
    rejMeters.forEach((rm) => {
      const ro = roTrains.find((r) => r.id === rm.roId);
      if (ro) edges.push(drawPath(ro.id, rm.id, COLORS.reject.accent));
    });

    // Permeate → Bulk (editable)
    permToBulk.forEach((c) => {
      const pm = permMeters.find((m) => m.id === c.from);
      const bm = bulkMeters.find((m) => m.id === c.to);
      if (pm && bm) edges.push(drawPath(c.from, c.to, COLORS.bulk.accent));
    });

    // Bulk → Locator (editable)
    bulkToLoc.forEach((c) => {
      const bm = bulkMeters.find((m) => m.id === c.from);
      const loc = locators.find((l) => l.id === c.to);
      if (bm && loc) edges.push(drawPath(c.from, c.to, COLORS.locator.accent));
    });

    return edges;
  }

  // ─── Column header labels ─────────────────────────────────────────────────
  const HEADER_Y = 12;
  const headers = [
    { x: COLS.well + NODE_W/2,      label: "SOURCE" },
    { x: COLS.rawMeter + NODE_W/2,  label: "RAW METERS" },
    { x: COLS.pretreat + NODE_W/2,  label: "PRE-TREAT" },
    { x: COLS.feedMeter + NODE_W/2, label: "FEED" },
    { x: COLS.roTrain + NODE_W/2,   label: "RO TRAINS" },
    { x: COLS.permeate + NODE_W/2,  label: "OUTPUT" },
    { x: COLS.bulk + NODE_W/2,      label: "BULK METER" },
    { x: COLS.locator + NODE_W/2,   label: "LOCATORS" },
  ];

  const SVG_W = COLS.locator + NODE_W + 30;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0e1a",
      color: "#e2e8f0",
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      padding: "0",
    }}>
      {/* Header bar */}
      <div style={{
        background: "linear-gradient(90deg, #0d1b2a 0%, #112240 100%)",
        borderBottom: "1px solid #1e3a5f",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "#4a9eff", textTransform: "uppercase", fontFamily: "'IBM Plex Mono', monospace" }}>PWRI Plant Monitor</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", letterSpacing: -0.3 }}>Network Topology</div>
          </div>
          {/* Plant selector */}
          <div style={{ display: "flex", gap: 6 }}>
            {topology.plants.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelectedPlant(p.id); setPendingFrom(null); }}
                style={{
                  padding: "5px 14px",
                  borderRadius: 6,
                  border: selectedPlant === p.id ? "1px solid #4a9eff" : "1px solid #2d3748",
                  background: selectedPlant === p.id ? "rgba(74,158,255,0.15)" : "transparent",
                  color: selectedPlant === p.id ? "#7ec8e3" : "#718096",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Right controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saved && (
            <span style={{ fontSize: 11, color: "#48bb78", fontFamily: "'IBM Plex Mono', monospace" }}>
              ✓ Saved
            </span>
          )}

          {/* Admin toggle */}
          <button
            onClick={() => {
              setIsAdmin(!isAdmin);
              setEditMode(null);
              setPendingFrom(null);
            }}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: isAdmin ? "1px solid #f6ad55" : "1px solid #2d3748",
              background: isAdmin ? "rgba(246,173,85,0.15)" : "transparent",
              color: isAdmin ? "#f6ad55" : "#718096",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isAdmin ? "⚙ Admin Mode" : "🔒 View Mode"}
          </button>

          <button
            onClick={() => setShowHelp(!showHelp)}
            style={{
              width: 28, height: 28,
              borderRadius: "50%",
              border: "1px solid #2d3748",
              background: "transparent",
              color: "#718096",
              fontSize: 13,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >?</button>
        </div>
      </div>

      {/* Help panel */}
      {showHelp && (
        <div style={{
          background: "#0d1b2a",
          borderBottom: "1px solid #1e3a5f",
          padding: "12px 24px",
          fontSize: 12,
          color: "#a0aec0",
          display: "flex",
          gap: 24,
        }}>
          <div><strong style={{ color: "#7ec8e3" }}>Flow:</strong> Well → Raw Meter → Pre-treatment → Feed Meter → RO Train → Permeate/Reject Meter → Bulk/Mother Meter → Locator</div>
          <div><strong style={{ color: "#f6ad55" }}>Admin:</strong> Enable Admin Mode, then use Connect/Disconnect to edit editable connections (Wells↔RO Trains, Permeate↔Bulk, Bulk↔Locators)</div>
          <div><strong style={{ color: "#48bb78" }}>Tip:</strong> Changes auto-save to your browser storage</div>
        </div>
      )}

      {/* Admin toolbar */}
      {isAdmin && (
        <div style={{
          background: "rgba(246,173,85,0.05)",
          borderBottom: "1px solid rgba(246,173,85,0.2)",
          padding: "8px 24px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ fontSize: 11, color: "#f6ad55", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1 }}>EDIT CONNECTIONS:</span>
          {["connect", "disconnect"].map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setEditMode(editMode === mode ? null : mode);
                setPendingFrom(null);
              }}
              style={{
                padding: "4px 12px",
                borderRadius: 5,
                border: editMode === mode
                  ? `1px solid ${mode === "connect" ? "#48bb78" : "#fc8181"}`
                  : "1px solid #2d3748",
                background: editMode === mode
                  ? mode === "connect" ? "rgba(72,187,120,0.15)" : "rgba(252,129,129,0.15)"
                  : "transparent",
                color: editMode === mode
                  ? mode === "connect" ? "#48bb78" : "#fc8181"
                  : "#718096",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {mode === "connect" ? "+ Connect" : "– Disconnect"}
            </button>
          ))}
          {pendingFrom && (
            <span style={{ fontSize: 11, color: "#f6e05e", fontFamily: "'IBM Plex Mono', monospace" }}>
              Click a compatible node to {editMode}… (ESC to cancel)
            </span>
          )}
          {pendingFrom && (
            <button
              onClick={() => setPendingFrom(null)}
              style={{ fontSize: 11, color: "#718096", background: "none", border: "none", cursor: "pointer" }}
            >
              ✕ Cancel
            </button>
          )}

          <div style={{ marginLeft: "auto", fontSize: 11, color: "#718096" }}>
            Editable: <span style={{ color: "#a0aec0" }}>Wells↔RO Trains &nbsp;·&nbsp; Permeate↔Bulk &nbsp;·&nbsp; Bulk↔Locators</span>
          </div>
        </div>
      )}

      {/* Main diagram */}
      <div style={{ overflowX: "auto", padding: "16px 24px" }}>
        <svg
          ref={svgRef}
          width={SVG_W}
          height={SVG_H + 30}
          style={{ display: "block" }}
        >
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="#4a5568" />
            </marker>
            {/* Subtle grid pattern */}
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a2744" strokeWidth="0.5" />
            </pattern>
          </defs>

          {/* Background */}
          <rect width={SVG_W} height={SVG_H + 30} fill="#0a0e1a" />
          <rect width={SVG_W} height={SVG_H + 30} fill="url(#grid)" />

          {/* Column headers */}
          <g transform="translate(0,0)">
            {headers.map((h) => (
              <text
                key={h.label}
                x={h.x}
                y={HEADER_Y}
                textAnchor="middle"
                fill="#2d4a6e"
                fontSize={8}
                fontFamily="'IBM Plex Mono', monospace"
                letterSpacing={1.5}
              >
                {h.label}
              </text>
            ))}
          </g>

          {/* Column separators */}
          {[COLS.rawMeter - 10, COLS.pretreat - 10, COLS.feedMeter - 10, COLS.roTrain - 10,
            COLS.permeate - 10, COLS.bulk - 10, COLS.locator - 10].map((cx) => (
            <line
              key={cx}
              x1={cx} y1={20} x2={cx} y2={SVG_H + 10}
              stroke="#1a2744"
              strokeWidth={1}
              strokeDasharray="3,6"
            />
          ))}

          {/* Edges */}
          <g>{buildEdges()}</g>

          {/* Nodes */}
          <g transform={`translate(0,24)`}>
            {wells.map((w, i) => renderNode(w.id, "well", w.name, COLS.well, nodeY(null, i), w.status))}
            {rawMeters.map((m, i) => renderNode(m.id, "rawMeter", m.name, COLS.rawMeter, nodeY(null, i)))}
            {pretreat.map((p, i) => renderNode(p.id, "pretreat", p.name, COLS.pretreat, nodeY(null, i)))}
            {feedMeters.map((f, i) => renderNode(f.id, "feedMeter", f.name, COLS.feedMeter, nodeY(null, i)))}
            {roTrains.map((r, i) => renderNode(r.id, "roTrain", r.name, COLS.roTrain, nodeY(null, i), r.status))}
            {permMeters.map((m, i) => renderNode(m.id, "permeate", m.name, COLS.permeate, nodeY(null, i)))}
            {rejMeters.map((m, i) => renderNode(m.id, "reject", m.name, COLS.reject, nodeY(null, permMeters.length + i)))}
            {bulkMeters.map((m, i) => renderNode(m.id, "bulk", m.name, COLS.bulk, nodeY(null, i)))}
            {locators.map((l, i) => renderNode(l.id, "locator", l.name, COLS.locator, nodeY(null, i), l.status ?? "Active"))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div style={{
        padding: "12px 24px 20px",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        borderTop: "1px solid #1e3a5f",
      }}>
        {Object.entries(COLORS).map(([type, c]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 10, height: 10, borderRadius: 2,
              background: c.bg, border: `1px solid ${c.border}`
            }} />
            <span style={{ fontSize: 10, color: "#718096", fontFamily: "'IBM Plex Mono', monospace" }}>
              {NODE_TYPES[type]}
            </span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#48bb78" }} />
            <span style={{ fontSize: 10, color: "#718096", fontFamily: "'IBM Plex Mono', monospace" }}>Active</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e53e3e" }} />
            <span style={{ fontSize: 10, color: "#718096", fontFamily: "'IBM Plex Mono', monospace" }}>Inactive</span>
          </div>
        </div>
      </div>
    </div>
  );
}
