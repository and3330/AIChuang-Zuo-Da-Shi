import { useState, useRef, useCallback, useEffect } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const NODE_TYPES = {
  script_input:   { label: "📝 劇本輸入",     color: "#6366f1", category: "input" },
  character_db:   { label: "👤 角色資料庫",   color: "#8b5cf6", category: "input" },
  style_preset:   { label: "🎨 風格設定",     color: "#a78bfa", category: "input" },
  claude_scene:   { label: "🧠 Claude 分鏡",  color: "#0ea5e9", category: "ai" },
  prompt_boost:   { label: "⚡ Prompt 優化",  color: "#06b6d4", category: "ai" },
  seeddream_img:  { label: "🖼 SeedDream 出圖", color: "#10b981", category: "ai" },
  seeddance_vid:  { label: "🎬 SeedDance 動態", color: "#f59e0b", category: "ai" },
  subtitle_layer: { label: "💬 字幕疊加",     color: "#ef4444", category: "post" },
  ffmpeg_merge:   { label: "🔧 FFmpeg 合成",  color: "#f97316", category: "post" },
  preview_out:    { label: "▶️ 預覽輸出",     color: "#ec4899", category: "output" },
  export_out:     { label: "⬇️ 匯出影片",     color: "#e11d48", category: "output" },
};

const CATEGORY_COLORS = {
  input:  "#6366f1",
  ai:     "#0ea5e9",
  post:   "#f97316",
  output: "#ec4899",
};

const DEFAULT_NODES = [
  { id: "n1", type: "script_input",   x: 60,  y: 120, w: 200, h: 110, inputs: [],       outputs: ["text"],   params: { content: "今天教大家什麼是 Vibe Coding..." } },
  { id: "n2", type: "character_db",   x: 60,  y: 280, w: 200, h: 110, inputs: [],       outputs: ["char"],   params: { name: "老師 Sandy", style: "動漫風，短髮，眼鏡" } },
  { id: "n3", type: "style_preset",   x: 60,  y: 440, w: 200, h: 110, inputs: [],       outputs: ["style"],  params: { preset: "漫畫風" } },
  { id: "n4", type: "claude_scene",   x: 340, y: 180, w: 220, h: 130, inputs: ["text","char","style"], outputs: ["scenes"], params: { panels: "5格", model: "claude-sonnet" } },
  { id: "n5", type: "prompt_boost",   x: 340, y: 360, w: 220, h: 110, inputs: ["scenes"], outputs: ["prompts"], params: { lang: "English" } },
  { id: "n6", type: "seeddream_img",  x: 640, y: 200, w: 220, h: 130, inputs: ["prompts","char"], outputs: ["images"], params: { size: "1024x768", seed: "fixed" } },
  { id: "n7", type: "seeddance_vid",  x: 640, y: 390, w: 220, h: 130, inputs: ["images"], outputs: ["clips"], params: { motion: "輕微動態", duration: "3s" } },
  { id: "n8", type: "subtitle_layer", x: 930, y: 220, w: 200, h: 110, inputs: ["clips","scenes"], outputs: ["subbed"], params: { font: "思源黑體", size: "28px" } },
  { id: "n9", type: "ffmpeg_merge",   x: 930, y: 380, w: 200, h: 110, inputs: ["subbed"], outputs: ["video"], params: { fps: "24", format: "mp4" } },
  { id: "n10",type: "preview_out",    x: 1200,y: 260, w: 180, h: 90,  inputs: ["video"], outputs: [],        params: {} },
  { id: "n11",type: "export_out",     x: 1200,y: 390, w: 180, h: 90,  inputs: ["video"], outputs: [],        params: {} },
];

const DEFAULT_EDGES = [
  { id: "e1",  from: "n1", fromPort: "text",   to: "n4", toPort: "text" },
  { id: "e2",  from: "n2", fromPort: "char",   to: "n4", toPort: "char" },
  { id: "e3",  from: "n3", fromPort: "style",  to: "n4", toPort: "style" },
  { id: "e4",  from: "n4", fromPort: "scenes", to: "n5", toPort: "scenes" },
  { id: "e5",  from: "n5", fromPort: "prompts",to: "n6", toPort: "prompts" },
  { id: "e6",  from: "n2", fromPort: "char",   to: "n6", toPort: "char" },
  { id: "e7",  from: "n6", fromPort: "images", to: "n7", toPort: "images" },
  { id: "e8",  from: "n7", fromPort: "clips",  to: "n8", toPort: "clips" },
  { id: "e9",  from: "n4", fromPort: "scenes", to: "n8", toPort: "scenes" },
  { id: "e10", from: "n8", fromPort: "subbed", to: "n9", toPort: "subbed" },
  { id: "e11", from: "n9", fromPort: "video",  to: "n10",toPort: "video" },
  { id: "e12", from: "n9", fromPort: "video",  to: "n11",toPort: "video" },
];

// ─── PORT POSITIONS ───────────────────────────────────────────────────────────
function getPortPos(node, port, isOutput) {
  const ports = isOutput ? node.outputs : node.inputs;
  const idx = ports.indexOf(port);
  const count = ports.length;
  const spacing = node.h / (count + 1);
  const y = node.y + spacing * (idx + 1);
  const x = isOutput ? node.x + node.w : node.x;
  return { x, y };
}

// ─── EDGE PATH ────────────────────────────────────────────────────────────────
function edgePath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ComicFlow() {
  const [nodes, setNodes] = useState(DEFAULT_NODES);
  const [edges, setEdges] = useState(DEFAULT_EDGES);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("pro"); // "pro" | "simple"
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.85);
  const [dragging, setDragging] = useState(null);
  const [connecting, setConnecting] = useState(null); // {fromNode, fromPort, x, y}
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showNodeMenu, setShowNodeMenu] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const svgRef = useRef(null);

  // ── SIMULATE RUN ──
  const handleRun = useCallback(async () => {
    setRunning(true);
    setRunProgress({});
    const order = ["n1","n2","n3","n4","n5","n6","n7","n8","n9","n10"];
    for (const id of order) {
      setRunProgress(p => ({ ...p, [id]: "running" }));
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      setRunProgress(p => ({ ...p, [id]: "done" }));
    }
    setRunning(false);
  }, []);

  // ── DRAG NODE ──
  const startDrag = useCallback((e, nodeId) => {
    if (connecting) return;
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    setSelected(nodeId);
    setDragging({ id: nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y });
  }, [nodes, connecting]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const dx = (e.clientX - dragging.startX) / zoom;
      const dy = (e.clientY - dragging.startY) / zoom;
      setNodes(ns => ns.map(n => n.id === dragging.id
        ? { ...n, x: dragging.origX + dx, y: dragging.origY + dy }
        : n
      ));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, zoom]);

  // ── PAN CANVAS ──
  const startPan = useCallback((e) => {
    if (e.target !== svgRef.current && !e.target.classList.contains("canvas-bg")) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e) => setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    const onUp = () => setIsPanning(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isPanning]);

  // ── ZOOM ──
  const onWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.3, z - e.deltaY * 0.001)));
  }, []);

  // ── MOUSE TRACK for connecting ──
  const onMouseMove = useCallback((e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setMousePos({ x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom });
  }, [pan, zoom]);

  // ── START CONNECT ──
  const startConnect = useCallback((e, nodeId, port) => {
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    const pos = getPortPos(node, port, true);
    setConnecting({ fromNode: nodeId, fromPort: port, x: pos.x, y: pos.y });
  }, [nodes]);

  // ── FINISH CONNECT ──
  const finishConnect = useCallback((e, nodeId, port) => {
    e.stopPropagation();
    if (!connecting || connecting.fromNode === nodeId) { setConnecting(null); return; }
    const newEdge = { id: `e${Date.now()}`, from: connecting.fromNode, fromPort: connecting.fromPort, to: nodeId, toPort: port };
    setEdges(es => [...es, newEdge]);
    setConnecting(null);
  }, [connecting]);

  // ── DELETE NODE ──
  const deleteNode = useCallback((id) => {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.from !== id && e.to !== id));
    setSelected(null);
  }, []);

  // ── ADD NODE ──
  const addNode = useCallback((type) => {
    const def = NODE_TYPES[type];
    const id = `n${Date.now()}`;
    setNodes(ns => [...ns, {
      id, type, x: 400 - pan.x / zoom, y: 300 - pan.y / zoom,
      w: 210, h: 120,
      inputs: Object.keys(NODE_TYPES).find(k => k === type) ? [] : [],
      outputs: [],
      params: {}
    }]);
    setShowNodeMenu(false);
  }, [pan, zoom]);

  const selectedNode = nodes.find(n => n.id === selected);

  // ─── SIMPLE MODE ───────────────────────────────────────────────────────────
  if (mode === "simple") {
    return (
      <div style={styles.root}>
        <div style={styles.topBar}>
          <div style={styles.logo}>🎬 <span style={{ color: "#a78bfa" }}>Comic</span>Flow</div>
          <div style={styles.modeToggle}>
            <button style={styles.modeBtn} onClick={() => setMode("simple")}>✦ 簡單模式</button>
            <button style={{ ...styles.modeBtn, ...styles.modeBtnInactive }} onClick={() => setMode("pro")}>⚙ 進階節點</button>
          </div>
          <div />
        </div>
        <div style={styles.simpleBody}>
          <div style={styles.simpleCard}>
            <div style={styles.simpleTitle}>🎬 一鍵生成AI漫劇</div>
            <div style={styles.simpleSubtitle}>輸入課程內容，自動產出動態漫畫劇集</div>

            <label style={styles.label}>課程段落文字</label>
            <textarea style={styles.textarea} rows={5} defaultValue="今天要教大家什麼是 Vibe Coding，以及如何用 AI 做出屬於自己的 App..." />

            <div style={styles.row}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>角色</label>
                <select style={styles.select}>
                  <option>老師 Sandy（動漫風）</option>
                  <option>新增角色...</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>格數</label>
                <select style={styles.select}>
                  <option>3格</option><option>5格</option><option>8格</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>風格</label>
                <select style={styles.select}>
                  <option>漫畫風</option><option>Q版卡通</option><option>寫實插畫</option>
                </select>
              </div>
            </div>

            <button style={styles.runBtn} onClick={handleRun} disabled={running}>
              {running ? "⏳ 生成中..." : "🚀 開始生成"}
            </button>

            {running && (
              <div style={styles.progressBar}>
                <div style={styles.progressSteps}>
                  {["分析劇本","拆解分鏡","生成圖像","動態化","合成字幕","輸出影片"].map((s, i) => (
                    <div key={i} style={{ ...styles.step, color: i < 3 ? "#a78bfa" : "#555" }}>
                      {i < 3 ? "✓" : i === 3 ? "⟳" : "○"} {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!running && Object.keys(runProgress).length > 0 && (
              <div style={styles.outputPreview}>
                <div style={styles.previewLabel}>✅ 生成完成</div>
                <div style={styles.previewFrames}>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} style={styles.frame}>
                      <div style={styles.frameInner}>場景 {i}</div>
                    </div>
                  ))}
                </div>
                <button style={styles.dlBtn}>⬇ 下載 MP4</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── PRO MODE ──────────────────────────────────────────────────────────────
  return (
    <div style={styles.root} onMouseMove={onMouseMove}>
      {/* TOP BAR */}
      <div style={styles.topBar}>
        <div style={styles.logo}>🎬 <span style={{ color: "#a78bfa" }}>Comic</span>Flow</div>
        <div style={styles.modeToggle}>
          <button style={{ ...styles.modeBtn, ...styles.modeBtnInactive }} onClick={() => setMode("simple")}>✦ 簡單模式</button>
          <button style={styles.modeBtn} onClick={() => setMode("pro")}>⚙ 進階節點</button>
        </div>
        <div style={styles.topActions}>
          <button style={styles.addNodeBtn} onClick={() => setShowNodeMenu(v => !v)}>＋ 新增節點</button>
          <button style={styles.runBtn2} onClick={handleRun} disabled={running}>
            {running ? "⏳ 執行中..." : "▶ 執行流程"}
          </button>
        </div>
      </div>

      {/* NODE MENU */}
      {showNodeMenu && (
        <div style={styles.nodeMenu}>
          <div style={styles.nodeMenuTitle}>選擇節點類型</div>
          {Object.entries(NODE_TYPES).map(([type, def]) => (
            <button key={type} style={{ ...styles.nodeMenuItem, borderLeft: `3px solid ${def.color}` }}
              onClick={() => addNode(type)}>
              {def.label}
              <span style={{ ...styles.catBadge, background: CATEGORY_COLORS[def.category] }}>
                {def.category}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={styles.workspace}>
        {/* SIDEBAR */}
        <div style={styles.sidebar}>
          <div style={styles.sideSection}>節點面板</div>
          {["input","ai","post","output"].map(cat => (
            <div key={cat}>
              <div style={{ ...styles.catLabel, color: CATEGORY_COLORS[cat] }}>
                {cat === "input" ? "📥 輸入" : cat === "ai" ? "🤖 AI處理" : cat === "post" ? "🎞 後製" : "📤 輸出"}
              </div>
              {Object.entries(NODE_TYPES).filter(([,v]) => v.category === cat).map(([type, def]) => (
                <div key={type} style={styles.sideNode}
                  draggable onDragEnd={() => addNode(type)}>
                  <span style={{ ...styles.sideNodeDot, background: def.color }} />
                  <span style={{ fontSize: 11 }}>{def.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* CANVAS */}
        <div style={styles.canvasWrap} onWheel={onWheel}>
          <svg ref={svgRef} style={styles.canvas} className="canvas-bg"
            onMouseDown={startPan}
            onClick={() => { setSelected(null); setShowNodeMenu(false); }}>
            <defs>
              <pattern id="grid" width={24 * zoom} height={24 * zoom} patternUnits="userSpaceOnUse"
                x={pan.x % (24 * zoom)} y={pan.y % (24 * zoom)}>
                <circle cx="0" cy="0" r="0.8" fill="#2a2a3a" />
              </pattern>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {/* EDGES */}
              {edges.map(edge => {
                const fromNode = nodes.find(n => n.id === edge.from);
                const toNode = nodes.find(n => n.id === edge.to);
                if (!fromNode || !toNode) return null;
                const p1 = getPortPos(fromNode, edge.fromPort, true);
                const p2 = getPortPos(toNode, edge.toPort, false);
                const color = NODE_TYPES[fromNode.type]?.color || "#666";
                return (
                  <g key={edge.id}>
                    <path d={edgePath(p1.x, p1.y, p2.x, p2.y)}
                      fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.35" />
                    <path d={edgePath(p1.x, p1.y, p2.x, p2.y)}
                      fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.9"
                      strokeDasharray={running ? "6 4" : "none"}
                      style={running ? { animation: "dash 1s linear infinite" } : {}} />
                  </g>
                );
              })}

              {/* LIVE CONNECTING LINE */}
              {connecting && (
                <path d={edgePath(connecting.x, connecting.y, mousePos.x, mousePos.y)}
                  fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="5 3" strokeOpacity="0.6" />
              )}

              {/* NODES */}
              {nodes.map(node => {
                const def = NODE_TYPES[node.type];
                if (!def) return null;
                const isSelected = selected === node.id;
                const status = runProgress[node.id];
                const borderColor = status === "running" ? "#facc15" : status === "done" ? "#22c55e" : isSelected ? def.color : "#2a2a3a";
                return (
                  <g key={node.id} transform={`translate(${node.x},${node.y})`}
                    onMouseDown={e => startDrag(e, node.id)}
                    onClick={e => { e.stopPropagation(); setSelected(node.id); }}
                    style={{ cursor: "grab" }}>

                    {/* shadow */}
                    <rect x={3} y={3} width={node.w} height={node.h} rx={10}
                      fill="black" fillOpacity="0.4" />

                    {/* body */}
                    <rect width={node.w} height={node.h} rx={10}
                      fill="#131320" stroke={borderColor} strokeWidth={isSelected ? 2 : 1.5} />

                    {/* header */}
                    <rect width={node.w} height={32} rx={10} fill={def.color} fillOpacity="0.2" />
                    <rect y={22} width={node.w} height={10} fill={def.color} fillOpacity="0.2" />

                    {/* accent line */}
                    <rect width={4} height={node.h} rx={2} fill={def.color} />

                    {/* title */}
                    <text x={14} y={20} fill={def.color} fontSize={12} fontWeight="600"
                      fontFamily="'Noto Sans TC', sans-serif">{def.label}</text>

                    {/* status indicator */}
                    {status === "running" && (
                      <circle cx={node.w - 14} cy={16} r={5} fill="#facc15" filter="url(#glow)">
                        <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />
                      </circle>
                    )}
                    {status === "done" && (
                      <circle cx={node.w - 14} cy={16} r={5} fill="#22c55e" />
                    )}

                    {/* params preview */}
                    {Object.entries(node.params).slice(0, 2).map(([k, v], i) => (
                      <g key={k}>
                        <text x={12} y={52 + i * 20} fill="#666" fontSize={9} fontFamily="monospace">{k}</text>
                        <text x={12} y={64 + i * 20} fill="#aaa" fontSize={10}
                          fontFamily="'Noto Sans TC', sans-serif">
                          {String(v).length > 22 ? String(v).slice(0, 22) + "…" : String(v)}
                        </text>
                      </g>
                    ))}

                    {/* INPUT PORTS */}
                    {node.inputs.map((port, i) => {
                      const spacing = node.h / (node.inputs.length + 1);
                      const py = spacing * (i + 1);
                      return (
                        <g key={port} onMouseUp={e => finishConnect(e, node.id, port)}
                          style={{ cursor: "crosshair" }}>
                          <circle cx={0} cy={py} r={7} fill="#131320" stroke="#444" strokeWidth={1.5} />
                          <circle cx={0} cy={py} r={4} fill="#333" />
                          <text x={8} y={py + 4} fill="#666" fontSize={8} fontFamily="monospace">{port}</text>
                        </g>
                      );
                    })}

                    {/* OUTPUT PORTS */}
                    {node.outputs.map((port, i) => {
                      const spacing = node.h / (node.outputs.length + 1);
                      const py = spacing * (i + 1);
                      return (
                        <g key={port} onMouseDown={e => startConnect(e, node.id, port)}
                          style={{ cursor: "crosshair" }}>
                          <circle cx={node.w} cy={py} r={7} fill="#131320" stroke={def.color} strokeWidth={1.5} />
                          <circle cx={node.w} cy={py} r={4} fill={def.color} fillOpacity="0.5" />
                          <text x={node.w - 8} y={py + 4} fill="#666" fontSize={8}
                            textAnchor="end" fontFamily="monospace">{port}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* INSPECTOR PANEL */}
        {selectedNode && (
          <div style={styles.inspector}>
            <div style={styles.inspectorTitle}>
              <span>{NODE_TYPES[selectedNode.type]?.label}</span>
              <button style={styles.deleteBtn} onClick={() => deleteNode(selectedNode.id)}>🗑</button>
            </div>
            <div style={styles.inspectorBody}>
              {Object.entries(selectedNode.params).map(([k, v]) => (
                <div key={k} style={styles.paramRow}>
                  <label style={styles.paramLabel}>{k}</label>
                  {typeof v === "string" && v.length > 30
                    ? <textarea style={styles.paramTextarea} defaultValue={v}
                        onChange={e => setNodes(ns => ns.map(n => n.id === selectedNode.id
                          ? { ...n, params: { ...n.params, [k]: e.target.value } } : n))} />
                    : <input style={styles.paramInput} defaultValue={v}
                        onChange={e => setNodes(ns => ns.map(n => n.id === selectedNode.id
                          ? { ...n, params: { ...n.params, [k]: e.target.value } } : n))} />
                  }
                </div>
              ))}
              <div style={styles.portInfo}>
                <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>輸入埠</div>
                {selectedNode.inputs.map(p => <div key={p} style={styles.portTag}>◎ {p}</div>)}
                <div style={{ color: "#555", fontSize: 10, margin: "8px 0 4px" }}>輸出埠</div>
                {selectedNode.outputs.map(p => <div key={p} style={{ ...styles.portTag, borderColor: NODE_TYPES[selectedNode.type]?.color }}>{p} ◉</div>)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* STATUS BAR */}
      <div style={styles.statusBar}>
        <span style={{ color: "#444" }}>節點 {nodes.length} 個 ／ 連線 {edges.length} 條</span>
        <span style={{ color: "#444" }}>縮放 {Math.round(zoom * 100)}%</span>
        <span style={{ color: running ? "#facc15" : "#444" }}>
          {running ? "⟳ 執行中..." : "● 就緒"}
        </span>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600&family=JetBrains+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0d0d1a; }
        ::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 2px; }
        @keyframes dash { to { stroke-dashoffset: -20; } }
      `}</style>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = {
  root: { display: "flex", flexDirection: "column", height: "100vh", background: "#0a0a14",
    fontFamily: "'Noto Sans TC', 'JetBrains Mono', sans-serif", color: "#ccc", overflow: "hidden" },
  topBar: { display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 16px", height: 48, background: "#0d0d1a",
    borderBottom: "1px solid #1a1a2e", flexShrink: 0, gap: 12 },
  logo: { fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: 1, whiteSpace: "nowrap" },
  modeToggle: { display: "flex", gap: 2, background: "#111122", borderRadius: 8, padding: 3 },
  modeBtn: { padding: "5px 14px", borderRadius: 6, border: "none", background: "#6366f1",
    color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600 },
  modeBtnInactive: { background: "transparent", color: "#555" },
  topActions: { display: "flex", gap: 8, alignItems: "center" },
  addNodeBtn: { padding: "5px 12px", background: "#1a1a2e", border: "1px solid #333",
    borderRadius: 6, color: "#aaa", fontSize: 12, cursor: "pointer" },
  runBtn2: { padding: "5px 16px", background: "#6366f1", border: "none", borderRadius: 6,
    color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 700 },
  workspace: { display: "flex", flex: 1, overflow: "hidden" },
  sidebar: { width: 160, background: "#0d0d1a", borderRight: "1px solid #1a1a2e",
    overflowY: "auto", padding: "8px 0", flexShrink: 0 },
  sideSection: { fontSize: 10, color: "#444", padding: "6px 12px", letterSpacing: 1, textTransform: "uppercase" },
  catLabel: { fontSize: 10, fontWeight: 700, padding: "8px 12px 3px", letterSpacing: 0.5 },
  sideNode: { display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
    cursor: "grab", fontSize: 11, color: "#888", transition: "background 0.15s" },
  sideNodeDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  canvasWrap: { flex: 1, position: "relative", overflow: "hidden" },
  canvas: { width: "100%", height: "100%", display: "block", cursor: "default" },
  inspector: { width: 220, background: "#0d0d1a", borderLeft: "1px solid #1a1a2e",
    display: "flex", flexDirection: "column", flexShrink: 0 },
  inspectorTitle: { display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 12px", borderBottom: "1px solid #1a1a2e", fontSize: 12, fontWeight: 600, color: "#aaa" },
  deleteBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 14 },
  inspectorBody: { flex: 1, overflowY: "auto", padding: 10 },
  paramRow: { marginBottom: 10 },
  paramLabel: { display: "block", fontSize: 10, color: "#555", marginBottom: 3, textTransform: "uppercase" },
  paramInput: { width: "100%", background: "#111122", border: "1px solid #222",
    borderRadius: 5, padding: "5px 8px", color: "#ccc", fontSize: 11, fontFamily: "monospace" },
  paramTextarea: { width: "100%", background: "#111122", border: "1px solid #222",
    borderRadius: 5, padding: "5px 8px", color: "#ccc", fontSize: 11, fontFamily: "monospace",
    resize: "vertical", minHeight: 60 },
  portInfo: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #1a1a2e" },
  portTag: { fontSize: 10, color: "#888", border: "1px solid #222", borderRadius: 4,
    padding: "3px 8px", marginBottom: 3, fontFamily: "monospace" },
  statusBar: { height: 28, background: "#080810", borderTop: "1px solid #1a1a2e",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0 16px", fontSize: 10, flexShrink: 0 },
  nodeMenu: { position: "fixed", top: 52, right: 16, width: 220, background: "#0d0d1a",
    border: "1px solid #2a2a4a", borderRadius: 10, padding: 8, zIndex: 100,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)" },
  nodeMenuTitle: { fontSize: 10, color: "#555", padding: "4px 8px 8px", textTransform: "uppercase", letterSpacing: 1 },
  nodeMenuItem: { display: "flex", justifyContent: "space-between", alignItems: "center",
    width: "100%", padding: "7px 10px", background: "none", border: "none",
    borderBottom: "1px solid #111", color: "#aaa", fontSize: 11, cursor: "pointer",
    textAlign: "left", transition: "background 0.15s" },
  catBadge: { fontSize: 9, padding: "2px 5px", borderRadius: 3, color: "#fff", opacity: 0.8 },
  // SIMPLE MODE
  simpleBody: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(ellipse at 30% 40%, #1a0a2e 0%, #0a0a14 60%)", overflow: "auto" },
  simpleCard: { background: "#0d0d1a", border: "1px solid #2a2a4a", borderRadius: 16,
    padding: 32, width: 600, maxWidth: "95vw" },
  simpleTitle: { fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6 },
  simpleSubtitle: { fontSize: 13, color: "#555", marginBottom: 24 },
  label: { display: "block", fontSize: 11, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  textarea: { width: "100%", background: "#111122", border: "1px solid #222", borderRadius: 8,
    padding: "10px 12px", color: "#ccc", fontSize: 13, resize: "vertical",
    fontFamily: "'Noto Sans TC', sans-serif", marginBottom: 16 },
  row: { display: "flex", gap: 12, marginBottom: 20 },
  select: { width: "100%", background: "#111122", border: "1px solid #222", borderRadius: 6,
    padding: "8px 10px", color: "#ccc", fontSize: 12 },
  runBtn: { width: "100%", padding: "12px", background: "#6366f1", border: "none",
    borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 16 },
  progressBar: { background: "#111122", borderRadius: 8, padding: 16, marginBottom: 12 },
  progressSteps: { display: "flex", flexWrap: "wrap", gap: 12 },
  step: { fontSize: 11, display: "flex", alignItems: "center", gap: 4 },
  outputPreview: { background: "#111122", borderRadius: 8, padding: 16 },
  previewLabel: { fontSize: 13, color: "#22c55e", marginBottom: 12 },
  previewFrames: { display: "flex", gap: 8, marginBottom: 14, overflowX: "auto" },
  frame: { width: 90, height: 60, background: "#1a1a2e", borderRadius: 6, flexShrink: 0,
    border: "1px solid #2a2a4a", display: "flex", alignItems: "center", justifyContent: "center" },
  frameInner: { fontSize: 10, color: "#555" },
  dlBtn: { padding: "8px 20px", background: "#10b981", border: "none", borderRadius: 6,
    color: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 },
};
