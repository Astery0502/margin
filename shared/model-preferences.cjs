const modelPreferences = {
  normalize({ agentId, model, thinking, tier }) {
    const levels = model?.thinkingLevels;
    return {
      agentId, model,
      thinking: levels?.includes(thinking) ? thinking : levels?.[0],
      tier: model?.speedTiers?.includes(tier) ? tier : 'default',
    };
  },

  label(value) {
    if (value === 'default') return 'Provider default';
    if (value === 'xhigh') return 'Extra high';
    return value ? value[0].toUpperCase() + value.slice(1) : '';
  },
};

if (typeof module === 'undefined') globalThis.MarginModelPreferences = modelPreferences;
else module.exports = modelPreferences;
