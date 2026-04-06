// lib/stockfish.worker.ts
// Web Worker — Stockfish WASM와 메인 스레드를 분리
// public/stockfish.js 필요: https://github.com/lichess-org/stockfish.wasm

/// <reference lib="webworker" />

let sf: Worker | null = null;

function initStockfish() {
  sf = new Worker('/stockfish.js');
  sf.onmessage = (e: MessageEvent) => {
    self.postMessage({ type: 'sf_output', data: e.data });
  };
  sf.postMessage('uci');
  sf.postMessage('setoption name MultiPV value 3');
  sf.postMessage('isready');
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'init':
      initStockfish();
      break;

    case 'evaluate':
      if (!sf) break;
      sf.postMessage('stop');
      sf.postMessage(`position fen ${payload.fen}`);
      sf.postMessage(`go depth ${payload.depth ?? 20} movetime ${payload.movetime ?? 5000}`);
      break;

    case 'stop':
      sf?.postMessage('stop');
      break;

    case 'quit':
      sf?.postMessage('quit');
      sf = null;
      break;
  }
};
