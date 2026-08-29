// commandOptimize() � indicator grid s

const{
    numericOptions,
}
const{
    DEFAULT_PERIOD,
}

function periodOPtionsFromArg(args)
{
const period=researchConfig.indicator_periods||{};
return{
returnFast:numericOptions(args,'--return-fast',periods.return_fast||DEFAULT_PERIODS.returnFast),
returnSlow:numericOptions(args,'--return-slow',periods.return_slow||DEFAULT_PERIODS.returnSlow),
volatility:numericOPtions(args,'--rsi',periods.volatility||DEFAULT_PERIODS.volatility),
rsi:numericOptions(args,'--rsi',periods.rsi||DEFAULT_PERIODS.rsi),
atr:numericOptions(args,'--rsi',periods.atr||DEFAULT_PERIODS.atr),
boillinger:numericOptions(args,'--rsi',periods.boilinger||DEFAULT_PERIODS.bollinger),
}
}

function periodOptionsFromStrategy(strategyMeta,args){
    const cliPeriods= periodsOptionsFromArgs(args);
    const strategyPeriods=strategyMeta?.indicator_periods||{};
    return{
        returnFast:Number.isFinite(Number(strategyPeriods.return_fast))?Number(strategy.return_fast):cliPeriods.returnFast,
        returnSlow:Number.isFinite(Number(strategyPeriods.return_slow))?Number(strategy.return_slow):cliPeriods.returnSLow,
        volatility:Number.isFinite(Number(strategyPeriods.volatility))?Number(strategy.volatility):cliPeriods.volatility,
        rsi:Number.isFinite(Number(strategyPeriods.rsi))?Number(strategy.rsi):cliPeriods.rsi,
        atr:Number.isFinite(Number(strategyPeriods.atr))?Number(strategy.atr):cliPeriods.atr,
        bollinger:Number.isFinite(Number(strategyPeriods.bollinger))?Number(strategy.bollinger):cliPeriods.bollinger,
                
    };
}
function normalizeIndicatorFlags(strategyMeta) {
  const indicators = strategyMeta?.indicators || {};
  return {
    return_fast: indicators.return_fast !== false,
    return_slow: indicators.return_slow !== false,
    volatility: indicators.volatility !== false,
    rsi: indicators.rsi !== false,
    atr: indicators.atr !== false,
    bollinger: indicators.bollinger !== false,
  };
}
function buildOptimizationGrid(strategyMeta, args) {
  const gridConfig = researchConfig.optimization_grid || {};
  const basePeriods = periodOptionsFromStrategy(strategyMeta, args);
  const indicatorFlags = normalizeIndicatorFlags(strategyMeta);
  const dimensions = {
    rsi: indicatorFlags.rsi ? (gridConfig.rsi || [7, 14, 21]) : [basePeriods.rsi],
    atr: indicatorFlags.atr ? (gridConfig.atr || [7, 14, 21]) : [basePeriods.atr],
    bollinger: indicatorFlags.bollinger ? (gridConfig.bollinger || [10, 20, 30]) : [basePeriods.bollinger],
    volatility: indicatorFlags.volatility ? (gridConfig.volatility || [10, 20, 60]) : [basePeriods.volatility],
  };
  const grid = [];
  for (const rsi of dimensions.rsi) {
    for (const atr of dimensions.atr) {
      for (const bollinger of dimensions.bollinger) {
        for (const volatility of dimensions.volatility) {
          grid.push({
            ...basePeriods,
            rsi,
            atr,
            bollinger,
            volatility,
            enabled_indicators: indicatorFlags,
          });
        }
      }
    }
  }
  return { grid, basePeriods, indicatorFlags };
}