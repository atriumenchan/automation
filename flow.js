// flow.js
// Step-by-step page handler scaffold. We will add blocks one by one.

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function readSignals(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page
    .evaluate(() => document.body?.innerText || "")
    .catch(() => "");

  return {
    url,
    title,
    bodyText,
    titleN: normalizeText(title),
    bodyN: normalizeText(bodyText),
  };
}

function makeFlowHandler(context = {}) {
  const { debug = true } = context;

  // Add each step here in the exact order you provide.
  // Each step must return true if it handled the current page.
  const flowSteps = [
    {
      id: "placeholder_step_1",
      description: "Replace with your first real step",
      when: (_signals) => false,
      do: async (_page, _signals) => false,
    },
  ];

  async function handleCurrentPage(page) {
    const signals = await readSignals(page);

    for (const step of flowSteps) {
      let matched = false;
      try {
        matched = await step.when(signals);
      } catch (err) {
        if (debug) {
          console.log(`[flow] step "${step.id}" when() error: ${String(err)}`);
        }
      }

      if (!matched) continue;

      if (debug) {
        console.log(`[flow] matched step: ${step.id}`);
      }

      const handled = await step.do(page, signals);
      return {
        handled: Boolean(handled),
        stepId: step.id,
        url: signals.url,
      };
    }

    return {
      handled: false,
      stepId: null,
      url: signals.url,
    };
  }

  return {
    flowSteps,
    handleCurrentPage,
  };
}

module.exports = {
  makeFlowHandler,
};
