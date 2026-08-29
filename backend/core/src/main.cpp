#include "stats/stats_engine.hpp"
#include "correlation/correlation_engine.hpp"
#include "data/data_snapshot.hpp"
#include "indicators/indicator_engine.hpp"
#include "portfolio/portfolio_state.hpp"
#include "risk/pre_trade_risk.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

namespace {

std::string jsonEscape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const unsigned char ch : value) {
        switch (ch) {
        case '\\': out += "\\\\"; break;
        case '"':  out += "\\\""; break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:
            // RFC 8259 §7: control characters 0x00-0x1F must be escaped.
            // Use \uXXXX for the remaining non-printable range.
            if (ch < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04X", static_cast<unsigned>(ch));
                out += buf;
            } else {
                out += static_cast<char>(ch);
            }
            break;
        }
    }
    return out;
}

std::string optionValue(const std::vector<std::string>& args, const std::string& name, const std::string& fallback = "") {
    for (std::size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == name) {
            return args[i + 1];
        }
    }
    return fallback;
}

bool hasFlag(const std::vector<std::string>& args, const std::string& name) {
    for (const auto& arg : args) {
        if (arg == name) return true;
    }
    return false;
}

std::uintmax_t fileSizeOrZero(const std::filesystem::path& path) {
    std::error_code ec;
    const auto size = std::filesystem::file_size(path, ec);
    return ec ? 0 : size;
}

std::vector<double> parseEquityCsv(const std::string& csv, bool& ok) {
    std::vector<double> values;
    ok = true;
    std::stringstream stream(csv);
    std::string token;
    while (std::getline(stream, token, ',')) {
        if (token.empty()) {
            ok = false;
            return {};
        }
        try {
            std::size_t parsed = 0;
            const double value = std::stod(token, &parsed);
            if (parsed != token.size()) {
                ok = false;
                return {};
            }
            values.push_back(value);
        } catch (const std::exception&) {
            ok = false;
            return {};
        }
    }
    ok = !values.empty();
    return values;
}

bool parseDoubleStrict(const std::string& token, double& value) {
    try {
        std::size_t parsed = 0;
        value = std::stod(token, &parsed);
        return parsed == token.size();
    } catch (const std::exception&) {
        return false;
    }
}

std::vector<sovereign::Position> parsePositionsCsv(const std::string& csv, bool& ok, std::string& error) {
    std::vector<sovereign::Position> positions;
    ok = true;
    error.clear();
    if (csv.empty()) {
        return positions;
    }

    std::stringstream stream(csv);
    std::string row;
    while (std::getline(stream, row, ';')) {
        if (row.empty()) {
            continue;
        }

        std::vector<std::string> fields;
        std::stringstream row_stream(row);
        std::string field;
        while (std::getline(row_stream, field, ',')) {
            fields.push_back(field);
        }
        if (fields.size() != 4U || fields[0].empty()) {
            ok = false;
            error = "positions must use SYMBOL,QUANTITY,AVERAGE_COST,CURRENT_PRICE rows";
            return {};
        }

        sovereign::Position position;
        position.symbol = fields[0];
        if (!parseDoubleStrict(fields[1], position.quantity) ||
            !parseDoubleStrict(fields[2], position.average_cost) ||
            !parseDoubleStrict(fields[3], position.current_price)) {
            ok = false;
            error = "position quantity, average cost, and current price must be numeric";
            return {};
        }
        positions.push_back(position);
    }

    return positions;
}

std::size_t parseSizeOption(const std::vector<std::string>& args, const std::string& name, std::size_t fallback) {
    const std::string raw = optionValue(args, name);
    if (raw.empty()) {
        return fallback;
    }
    try {
        std::size_t parsed = 0;
        const auto value = static_cast<std::size_t>(std::stoull(raw, &parsed));
        return parsed == raw.size() ? value : fallback;
    } catch (const std::exception&) {
        return fallback;
    }
}

std::vector<std::string> parseSymbols(const std::vector<std::string>& args) {
    const std::string csv = optionValue(args, "--symbols");
    if (csv.empty()) {
        return {
            optionValue(args, "--lhs", "AAPL"),
            optionValue(args, "--mid", "MSFT"),
            optionValue(args, "--rhs", "SPY"),
        };
    }
    std::vector<std::string> symbols;
    std::stringstream stream(csv);
    std::string token;
    while (std::getline(stream, token, ',')) {
        if (!token.empty()) {
            symbols.push_back(token);
        }
    }
    return symbols;
}

void printRejectedReasons(const std::vector<std::string>& reasons) {
    std::cout << "    \"reasons\": [";
    constexpr std::size_t MAX_SHOWN = 8U;
    const std::size_t count = std::min<std::size_t>(reasons.size(), MAX_SHOWN);
    for (std::size_t i = 0; i < count; ++i) {
        if (i > 0) std::cout << ", ";
        std::cout << "\"" << jsonEscape(reasons[i]) << "\"";
    }
    if (reasons.size() > MAX_SHOWN) {
        std::cout << ", \"... " << (reasons.size() - MAX_SHOWN) << " more\"";
    }
    std::cout << "],\n";
    std::cout << "    \"rejected_total\": " << reasons.size() << "\n";
}

int printStatus(const std::vector<std::string>& args) {
    const auto snapshot = std::filesystem::path(optionValue(args, "--snapshot", "storage/data/cache/last_fetch.json"));
    const auto quality = std::filesystem::path(optionValue(args, "--quality", "storage/data/cache/data_quality_report.json"));
    const bool snapshotExists = std::filesystem::exists(snapshot);
    const bool qualityExists = std::filesystem::exists(quality);

    std::cout
        << "{\n"
        << "  \"type\": \"backend_status\",\n"
        << "  \"engine\": \"sovereign_cpp_core\",\n"
        << "  \"schema_version\": 1,\n"
            << "  \"ok\": " << (snapshotExists ? "true" : "false") << ",\n"
            << "  \"status_scope\": \"filesystem_presence\",\n"
        << "  \"snapshot\": {\n"
        << "    \"path\": \"" << jsonEscape(snapshot.generic_string()) << "\",\n"
        << "    \"exists\": " << (snapshotExists ? "true" : "false") << ",\n"
        << "    \"bytes\": " << fileSizeOrZero(snapshot) << "\n"
        << "  },\n"
        << "  \"quality_report\": {\n"
        << "    \"path\": \"" << jsonEscape(quality.generic_string()) << "\",\n"
        << "    \"exists\": " << (qualityExists ? "true" : "false") << ",\n"
        << "    \"bytes\": " << fileSizeOrZero(quality) << "\n"
        << "  }\n"
        << "}\n";
    return snapshotExists ? 0 : 1;
}

int printStats(const std::vector<std::string>& args) {
    bool parsed = true;
    const std::string equity_arg = optionValue(args, "--equity", "100,110,105,120,90,95,130");
    const std::vector<double> equity = parseEquityCsv(equity_arg, parsed);
    if (!parsed) {
        std::cout
            << "{\n"
            << "  \"type\": \"backend_stats\",\n"
            << "  \"engine\": \"sovereign_cpp_core\",\n"
            << "  \"schema_version\": 1,\n"
            << "  \"ok\": false,\n"
            << "  \"error\": \"invalid --equity CSV\"\n"
            << "}\n";
        return 1;
    }

    const auto stats = sovereign::StatsEngine::summarize(equity);
    std::cout
        << "{\n"
        << "  \"type\": \"backend_stats\",\n"
        << "  \"engine\": \"sovereign_cpp_core\",\n"
        << "  \"schema_version\": 1,\n"
        << "  \"ok\": " << (stats.ok ? "true" : "false") << ",\n"
        << "  \"observations\": " << stats.observations << ",\n"
        << "  \"cumulative_return\": " << stats.cumulative_return << ",\n"
        << "  \"annualized_return\": " << stats.annualized_return << ",\n"
        << "  \"volatility\": " << stats.volatility << ",\n"
        << "  \"sharpe\": " << stats.sharpe << ",\n"
        << "  \"sortino\": " << stats.sortino << ",\n"
        << "  \"max_drawdown\": " << stats.max_drawdown << ",\n"
        << "  \"calmar\": " << stats.calmar << ",\n"
        << "  \"drawdown\": {\n"
        << "    \"peak_index\": " << stats.drawdown.peak_index << ",\n"
        << "    \"trough_index\": " << stats.drawdown.trough_index << ",\n"
        << "    \"recovery_index\": " << stats.drawdown.recovery_index << ",\n"
        << "    \"recovered\": " << (stats.drawdown.recovered ? "true" : "false") << "\n"
        << "  }\n"
        << "}\n";
    return stats.ok ? 0 : 1;
}

int printDataSummary(const std::vector<std::string>& args) {
    const std::string symbol = optionValue(args, "--symbol", "SPY");
    const std::string timeframe = optionValue(args, "--timeframe", "1d");
    const auto input = std::filesystem::path(optionValue(args, "--input", "storage/data/cache/backtest_history.json"));
    const std::size_t max_bars = parseSizeOption(args, "--max-bars", 0U);
    const auto snapshot = sovereign::loadMarketDataSnapshot(input, symbol, timeframe, max_bars);
    const auto& summary = snapshot.summary;
    std::cout
        << "{\n"
        << "  \"type\": \"market_data_summary\",\n"
        << "  \"engine\": \"sovereign_cpp_core\",\n"
        << "  \"schema_version\": 1,\n"
        << "  \"ok\": " << (snapshot.quality.ok ? "true" : "false") << ",\n"
        << "  \"input\": \"" << jsonEscape(input.generic_string()) << "\",\n"
        << "  \"summary\": {\n"
        << "    \"symbol\": \"" << jsonEscape(summary.symbol) << "\",\n"
        << "    \"timeframe\": \"" << jsonEscape(summary.timeframe) << "\",\n"
        << "    \"bars\": " << summary.bars << ",\n"
        << "    \"first_close\": " << summary.first_close << ",\n"
        << "    \"last_close\": " << summary.last_close << ",\n"
        << "    \"min_close\": " << summary.min_close << ",\n"
        << "    \"max_close\": " << summary.max_close << ",\n"
        << "    \"total_volume\": " << summary.total_volume << "\n"
        << "  },\n"
        << "  \"quality\": {\n"
        << "    \"ok\": " << (snapshot.quality.ok ? "true" : "false") << ",\n"
        << "    \"accepted_records\": " << snapshot.bars.size() << ",\n"
        << "    \"rejected_records\": " << snapshot.quality.rejected_records.size() << ",\n";
    printRejectedReasons(snapshot.quality.rejected_records);
    std::cout
        << "  }\n"
        << "}\n";
    return snapshot.quality.ok ? 0 : 1;
}

int printCorrelation(const std::vector<std::string>& args) {
    const std::vector<std::string> labels = parseSymbols(args);
    const std::string timeframe = optionValue(args, "--timeframe", "1d");
    const std::string method = optionValue(args, "--method", "pearson-levels");
    const bool use_returns = method == "pearson-returns" || method == "fx-returns";
    const auto input = std::filesystem::path(optionValue(args, "--input", "storage/data/cache/backtest_history.json"));
    const std::size_t max_bars = parseSizeOption(args, "--max-bars", 252U);
    std::vector<std::vector<double>> series;
    std::vector<std::string> rejected;
    std::size_t min_size = std::numeric_limits<std::size_t>::max();
    if (method != "pearson-levels" && method != "pearson-returns" && method != "fx-returns") {
        std::cout
            << "{\n"
            << "  \"type\": \"correlation_matrix\",\n"
            << "  \"engine\": \"sovereign_cpp_core\",\n"
            << "  \"schema_version\": 1,\n"
            << "  \"ok\": false,\n"
            << "  \"input\": \"" << jsonEscape(input.generic_string()) << "\",\n"
            << "  \"method\": \"" << jsonEscape(method) << "\",\n"
            << "  \"error\": \"unsupported correlation method\"\n"
            << "}\n";
        return 1;
    }
    for (const auto& label : labels) {
        const auto snapshot = sovereign::loadMarketDataSnapshot(input, label, timeframe, max_bars);
        if (!snapshot.quality.ok || snapshot.bars.size() < 2U) {
            rejected.insert(rejected.end(), snapshot.quality.rejected_records.begin(), snapshot.quality.rejected_records.end());
            if (snapshot.bars.size() < 2U) {
                rejected.push_back(label + ":" + timeframe + ":insufficient_bars");
            }
        }
        std::vector<double> closes;
        closes.reserve(snapshot.bars.size());
        for (const auto& bar : snapshot.bars) {
            closes.push_back(bar.close);
        }
        auto values = use_returns ? sovereign::logReturnSeries(closes) : std::move(closes);
        if (values.size() < 2U) {
            rejected.push_back(label + ":" + timeframe + ":insufficient_" + (use_returns ? "returns" : "bars"));
        }
        min_size = std::min(min_size, values.size());
        series.push_back(std::move(values));
    }
    if (labels.size() < 2U || min_size < 2U || !rejected.empty()) {
        std::cout
            << "{\n"
            << "  \"type\": \"correlation_matrix\",\n"
            << "  \"engine\": \"sovereign_cpp_core\",\n"
            << "  \"schema_version\": 1,\n"
            << "  \"ok\": false,\n"
            << "  \"input\": \"" << jsonEscape(input.generic_string()) << "\",\n"
            << "  \"error\": \"unable to build correlation matrix from requested symbols\",\n"
            << "  \"quality\": {\n"
            << "    \"ok\": false,\n"
            << "    \"accepted_series\": " << series.size() << ",\n"
            << "    \"rejected_records\": " << rejected.size() << ",\n";
        printRejectedReasons(rejected);
        std::cout << "  }\n}\n";
        return 1;
    }
    for (auto& values : series) {
        if (values.size() > min_size) {
            values.erase(values.begin(), values.end() - static_cast<std::ptrdiff_t>(min_size));
        }
    }
    const auto matrix = sovereign::CorrelationEngine::buildMatrix(labels, series);

    std::cout
        << "{\n"
        << "  \"type\": \"correlation_matrix\",\n"
        << "  \"engine\": \"sovereign_cpp_core\",\n"
        << "  \"schema_version\": 1,\n"
        << "  \"ok\": true,\n"
        << "  \"input\": \"" << jsonEscape(input.generic_string()) << "\",\n"
        << "  \"timeframe\": \"" << jsonEscape(timeframe) << "\",\n"
        << "  \"method\": \"" << jsonEscape(method) << "\",\n"
        << "  \"transform\": \"" << (use_returns ? "log_returns" : "close_levels") << "\",\n"
        << "  \"observations\": " << min_size << ",\n"
        << "  \"labels\": [";
    for (std::size_t i = 0; i < matrix.labels.size(); ++i) {
        if (i > 0) std::cout << ", ";
        std::cout << "\"" << jsonEscape(matrix.labels[i]) << "\"";
    }
    std::cout << "],\n  \"values\": [\n";
    for (std::size_t i = 0; i < matrix.values.size(); ++i) {
        std::cout << "    [";
        for (std::size_t j = 0; j < matrix.values[i].size(); ++j) {
            if (j > 0) std::cout << ", ";
            std::cout << matrix.values[i][j];
        }
        std::cout << "]";
        if (i + 1 < matrix.values.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "  ]";

    if (hasFlag(args, "--divergence")) {
        const std::size_t short_window = parseSizeOption(args, "--short-window", 10U);
        double threshold = 0.3;
        const std::string threshold_str = optionValue(args, "--threshold");
        if (!threshold_str.empty()) {
            parseDoubleStrict(threshold_str, threshold);
        }

        const auto divergences = sovereign::CorrelationEngine::computeDivergence(labels, series, short_window, threshold);
        std::cout << ",\n  \"divergences\": [\n";
        for (std::size_t i = 0; i < divergences.size(); ++i) {
            const auto& div = divergences[i];
            std::cout << "    {\n"
                      << "      \"lhs\": \"" << jsonEscape(div.lhs) << "\",\n"
                      << "      \"rhs\": \"" << jsonEscape(div.rhs) << "\",\n"
                      << "      \"short_corr\": " << div.short_corr << ",\n"
                      << "      \"long_corr\": " << div.long_corr << ",\n"
                      << "      \"diff\": " << div.diff << "\n"
                      << "    }";
            if (i + 1 < divergences.size()) std::cout << ",";
            std::cout << "\n";
        }
        std::cout << "  ]";
    }

    std::cout << "\n}\n";
    return 0;
}

int printUniverse(const std::vector<std::string>& args) {
    const auto input = std::filesystem::path(optionValue(args, "--input", "storage/data/cache/backtest_history.json"));
    const std::size_t max_entries = parseSizeOption(args, "--max-entries", 0U);
    const auto universe = sovereign::loadMarketUniverse(input, max_entries);
    std::cout
        << "{\n"
        << "  \"type\": \"market_universe\",\n"
        << "  \"engine\": \"sovereign_cpp_core\",\n"
        << "  \"schema_version\": 1,\n"
        << "  \"ok\": " << (universe.quality.ok ? "true" : "false") << ",\n"
        << "  \"input\": \"" << jsonEscape(input.generic_string()) << "\",\n"
        << "  \"entries\": [";
    for (std::size_t i = 0; i < universe.entries.size(); ++i) {
        if (i > 0) std::cout << ", ";
        std::cout << "{"
                  << "\"symbol\":\"" << jsonEscape(universe.entries[i].symbol) << "\","
                  << "\"records\":" << universe.entries[i].records << ","
                  << "\"timeframes\":[";
        for (std::size_t j = 0; j < universe.entries[i].timeframes.size(); ++j) {
            if (j > 0) std::cout << ", ";
            std::cout << "\"" << jsonEscape(universe.entries[i].timeframes[j]) << "\"";
        }
        std::cout << "]}";
    }
    std::cout
        << "],\n"
        << "  \"quality\": {\n"
        << "    \"ok\": " << (universe.quality.ok ? "true" : "false") << ",\n"
        << "    \"rejected_records\": " << universe.quality.rejected_records.size() << ",\n";
    printRejectedReasons(universe.quality.rejected_records);
    std::cout
        << "  }\n"
        << "}\n";
    return universe.quality.ok ? 0 : 1;
}

int printPortfolio(const std::vector<std::string>& args) {
    double cash = 0.0;
    const std::string cash_arg = optionValue(args, "--cash", "10000.0");
    if (!parseDoubleStrict(cash_arg, cash)) {
        std::cout
            << "{\n"
            << "  \"type\": \"portfolio_metrics\",\n"
            << "  \"engine\": \"sovereign_cpp_core\",\n"
            << "  \"schema_version\": 1,\n"
            << "  \"ok\": false,\n"
            << "  \"error\": \"invalid --cash value\"\n"
            << "}\n";
        return 1;
    }

    bool parsed = true;
    std::string error;
    sovereign::PortfolioState state;
    state.cash = cash;
    state.positions = parsePositionsCsv(optionValue(args, "--positions", ""), parsed, error);
    if (!parsed) {
        std::cout
            << "{\n"
            << "  \"type\": \"portfolio_metrics\",\n"
            << "  \"engine\": \"sovereign_cpp_core\",\n"
            << "  \"schema_version\": 1,\n"
            << "  \"ok\": false,\n"
            << "  \"error\": \"" << jsonEscape(error) << "\"\n"
            << "}\n";
        return 1;
    }

    const auto metrics = sovereign::PnlCalculator::calculate(state);
    std::cout
        << "{\n"
        << "  \"type\": \"portfolio_metrics\",\n"
        << "  \"engine\": \"sovereign_cpp_core\",\n"
        << "  \"schema_version\": 1,\n"
        << "  \"ok\": " << (metrics.ok ? "true" : "false") << ",\n"
        << "  \"cash\": " << state.cash << ",\n"
        << "  \"positions\": " << state.positions.size() << ",\n"
        << "  \"total_equity\": " << metrics.total_equity << ",\n"
        << "  \"total_unrealized_pnl\": " << metrics.total_unrealized_pnl << ",\n"
        << "  \"net_exposure\": " << metrics.net_exposure << ",\n"
        << "  \"gross_exposure\": " << metrics.gross_exposure << ",\n"
        << "  \"total_exposure\": " << metrics.total_exposure << "\n"
        << "}\n";
    return metrics.ok ? 0 : 1;
}

int printIndicators(const std::vector<std::string>& args) {
    const std::string symbol = optionValue(args, "--symbol", "AAPL");
    const std::string timeframe = optionValue(args, "--timeframe", "1d");
    const auto input = std::filesystem::path(optionValue(args, "--input", "storage/data/cache/backtest_history.json"));
    const std::size_t max_bars = parseSizeOption(args, "--max-bars", 0U);
    const std::size_t show_last = parseSizeOption(args, "--show-last", 5U);

    const auto snapshot = sovereign::loadMarketDataSnapshot(input, symbol, timeframe, max_bars);
    if (!snapshot.quality.ok || snapshot.bars.empty()) {
        std::cout << "{\"ok\":false,\"error\":\"failed to load market data for " << symbol << "\"}";
        return 1;
    }

    sovereign::indicators::ParameterMap params;
    const std::vector<std::string> param_keys = {
        "ret_fast", "ret_slow", "vol_period", "rsi_period", "kalman_q", "kalman_r",
        "macd_fast", "macd_slow", "sma_slow", "atr_period", "bb_period", "stoch_period", "stoch_signal"
    };

    for (const auto& key : param_keys) {
        std::string flag = "--" + key;
        std::replace(flag.begin(), flag.end(), '_', '-');
        const std::string val = optionValue(args, flag);
        if (!val.empty()) {
            double dval = 0.0;
            if (parseDoubleStrict(val, dval)) {
                params[key] = dval;
            }
        }
    }

    const auto frame = sovereign::indicators::IndicatorEngine::buildFrame(snapshot.bars, params);
    
    std::cout
        << "{\n"
        << "  \"type\": \"indicator_frame\",\n"
        << "  \"symbol\": \"" << jsonEscape(symbol) << "\",\n"
        << "  \"timeframe\": \"" << jsonEscape(timeframe) << "\",\n"
        << "  \"total_bars\": " << frame.rows.size() << ",\n"
        << "  \"ready_bars\": " << frame.ready_rows << ",\n"
        << "  \"rows\": [\n";

    const std::size_t start = (frame.rows.size() > show_last) ? (frame.rows.size() - show_last) : 0;
    for (std::size_t i = start; i < frame.rows.size(); ++i) {
        const auto& row = frame.rows[i];
        std::cout << "    {\n";
        std::cout << "      \"timestamp\": \"" << jsonEscape(row.bar.timestamp) << "\",\n";
        std::cout << "      \"open\": " << row.bar.open << ",\n";
        std::cout << "      \"high\": " << row.bar.high << ",\n";
        std::cout << "      \"low\": " << row.bar.low << ",\n";
        std::cout << "      \"close\": " << row.bar.close << ",\n";
        std::cout << "      \"volume\": " << row.bar.volume << ",\n";
        std::cout << "      \"metrics\": {\n";
        for (std::size_t j = 0; j < row.metrics.size(); ++j) {
            std::cout << "        \"" << jsonEscape(row.metrics[j].first) << "\": " << row.metrics[j].second;
            if (j + 1 < row.metrics.size()) std::cout << ",";
            std::cout << "\n";
        }
        std::cout << "      }\n";
        std::cout << "    }";
        if (i + 1 < frame.rows.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "  ]\n}\n";
    
    return 0;
}

int printRiskCheck(const std::vector<std::string>& args) {
    sovereign::RiskLimits limits;
    limits.max_drawdown = 0.20;
    const std::string max_dd_str = optionValue(args, "--max-drawdown");
    if (!max_dd_str.empty()) {
        parseDoubleStrict(max_dd_str, limits.max_drawdown);
    }
    limits.fail_closed = !hasFlag(args, "--fail-open");

    sovereign::TradeOrder order{};
    const std::string notional_str = optionValue(args, "--notional", "0.0");
    const std::string vol_str = optionValue(args, "--volatility", "1.0");
    const std::string dd_str = optionValue(args, "--drawdown", "0.0");
    
    parseDoubleStrict(notional_str, order.notional);
    parseDoubleStrict(vol_str, order.volatility);
    parseDoubleStrict(dd_str, order.current_drawdown);

    sovereign::PreTradeRisk engine(limits);
    const auto decision = engine.validate(order);

    std::cout
        << "{\n"
        << "  \"type\": \"risk_decision\",\n"
        << "  \"approved\": " << (decision.approved ? "true" : "false") << ",\n"
        << "  \"halt_trading\": " << (decision.halt_trading ? "true" : "false") << ",\n"
        << "  \"observed_drawdown\": " << decision.observed_drawdown << ",\n"
        << "  \"limit\": " << decision.limit << ",\n"
        << "  \"reason\": \"" << jsonEscape(decision.reason) << "\"\n"
        << "}\n";
    
    return decision.approved ? 0 : 2;
}

void printUsage() {
    std::cout
        << "Sovereign C++ Core\n"
        << "Commands:\n"
        << "  status --snapshot PATH --quality PATH --json\n"
        << "  stats --equity 100,110,105 --json\n"
        << "  data summary --symbol AAPL --timeframe 1d --json\n"
        << "  correlation --symbols AAPL,MSFT,SPY --timeframe 1d --json\n"
        << "  universe --input storage/data/cache/backtest_history.json --json\n"
        << "  portfolio --cash 10000.0 --positions \"AAPL,10,150,180;MSFT,5,300,320\"\n"
        << "  indicators --symbol AAPL --timeframe 1d --json\n"
        << "  risk check --notional 1000 --volatility 5000 --drawdown 0.05\n";
}

} // namespace

int main(int argc, char** argv) {
    std::vector<std::string> args;
    args.reserve(static_cast<std::size_t>(argc > 0 ? argc - 1 : 0));
    for (int i = 1; i < argc; ++i) {
        args.emplace_back(argv[i]);
    }

    const bool verbose = hasFlag(args, "--verbose");
    if (verbose) {
        std::cerr << "[VISIBILITY] Process Seam Invoke: ";
        for (const auto& arg : args) std::cerr << arg << " ";
        std::cerr << std::endl;
    }

    if (args.empty() || args[0] == "--help" || args[0] == "-h" || args[0] == "help") {
        printUsage();
        return 0;
    }

    if (args[0] == "status") {
        return printStatus(args);
    }
    if (args[0] == "stats") {
        return printStats(args);
    }
    if (args[0] == "kill-switch") {
        const auto lockPath = std::filesystem::path("storage/data/cache/kill_switch.lock");
        if (args.size() > 1) {
            const std::string sub = args[1];
            if (sub == "engage") {
                std::filesystem::create_directories(lockPath.parent_path());
                std::FILE* f = std::fopen(lockPath.string().c_str(), "w");
                if (f) std::fclose(f);
                std::cout << "{\"ok\":true,\"status\":\"engaged\"}\n";
                return 0;
            } else if (sub == "disengage") {
                std::error_code ec;
                std::filesystem::remove(lockPath, ec);
                std::cout << "{\"ok\":true,\"status\":\"disengaged\"}\n";
                return 0;
            } else if (sub == "status") {
                const bool engaged = std::filesystem::exists(lockPath);
                std::cout << "{\"ok\":true,\"status\":\"" << (engaged ? "engaged" : "disengaged") << "\"}\n";
                return 0;
            }
        }
        std::cerr << "Usage: kill-switch [engage|disengage|status]\n";
        return 1;
    }
    if (args[0] == "data") {
        const std::string subcommand = args.size() > 1 ? args[1] : "summary";
        if (subcommand == "summary") {
            return printDataSummary(args);
        }
        std::cerr << "Unknown data subcommand: " << subcommand << "\n";
        return 1;
    }
    if (args[0] == "correlation") {
        return printCorrelation(args);
    }
    if (args[0] == "universe") {
        return printUniverse(args);
    }
    if (args[0] == "portfolio") {
        return printPortfolio(args);
    }
    if (args[0] == "indicators") {
        return printIndicators(args);
    }
    if (args[0] == "risk" && args.size() > 1 && args[1] == "check") {
        return printRiskCheck(args);
    }

    std::cerr << "Unknown command: " << args[0] << "\n";
    printUsage();
    return 1;
}
