function createEconomicMutex() {
  let tail = Promise.resolve();

  async function acquire() {
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const previous = tail;
    tail = tail.then(() => turn);
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  return {
    acquire,
    async runExclusive(operation) {
      const release = await acquire();
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}

module.exports = { createEconomicMutex };
