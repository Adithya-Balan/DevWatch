    }

    /**
     * Build the static skeleton of the dropdown (header, separators, footer).
     * The dynamic projects section is injected by buildProjectSection().
     */
    _buildMenuSkeleton() {
        // Health summary (title + stats + refresh icon) is built dynamically
        // by buildHealthSummary() on every _refresh() — nothing static here.
    }

    /**
     * Update the panel status dot colour based on overall dev health.
     *
     * Red    — newly conflicting port
     * Yellow — high CPU (>80%)
     * Green  — all clear
     *
     * @param {Map<string, object>} projectMap
     * @param {{ ports: object[], newPorts: object[] }} portResult
     * @param {{ candidates: object[] }} cleanupResult
     */
    _updateStatusDot(
        projectMap,
        portResult     = { ports: [], newPorts: [] },
        buildResult    = { active: [], history: new Map() }
    ) {
        if (!this._statusDot) return;

        const hasConflict  = portResult.newPorts?.length > 0;
        const highCpu      = projectMap && [...projectMap.values()].some(p =>
            p.totalCpuPercent > 80
        );
        // A build hammering the CPU signals active work (yellow — not an error)
        const buildingHot  = buildResult.active?.some(r => r.peakCpuPct > 90);

        let dotClass = "devwatch-dot-green";
        if (hasConflict) dotClass = "devwatch-dot-red";
        else if (highCpu || buildingHot) dotClass = "devwatch-dot-yellow";

        this._statusDot.style_class = `devwatch-dot ${dotClass}`;
    }
