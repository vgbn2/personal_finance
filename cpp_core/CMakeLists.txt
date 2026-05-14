# Sovereign C++ Core - Wealth Engine
add_executable(sovereign_wealth 
    src/main.cpp 
    src/trading_system.cpp
    src/trading_system.hpp
)

# Include source directory for local headers
target_include_directories(sovereign_wealth PRIVATE src)
