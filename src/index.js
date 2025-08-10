import decision from './Decision/Decision.js';

async function runBot() {
  try {
    console.log("🤖 Starting Trading Bot...");
    await decision.analyze();
    console.log("✅ Trading Bot cycle finished.");
  } catch (err) {
    console.error("❌ Bot error:", err);
  }
}

setInterval(runBot, 60000); // Run every 60 seconds
runBot(); // Run immediately once
