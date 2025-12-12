# Cross-Reference Feature Reference Document {#sec:intro}

This document demonstrates all cross-reference features available in Korppi. It can be used to test importing markdown documents and exporting to DOCX format.

## Overview {#sec:overview}

Korppi supports three types of cross-references:

1. **Figures** - Images with captions and labels
2. **Sections** - Headings with labels
3. **Tables** - Tables with labels

Each type uses a consistent Pandoc-compatible syntax for labels (`{#type:label}`) and references (`@type:label`).

## Section References {#sec:sections}

Sections can be labeled by adding `{#sec:label}` at the end of any heading. For example, this section is labeled as `sec:sections`.

You can reference any labeled section:

- See @sec:intro for the introduction
- See @sec:overview for the overview
- See @sec:figures for information about figures
- See @sec:tables for table examples
- See @sec:combined for a combined example

### Subsection Example {#sec:subsection}

Subsections can also have labels. This subsection is labeled as `sec:subsection`.

As mentioned in @sec:overview, there are three types of cross-references. This subsection (@sec:subsection) demonstrates that any heading level can be labeled.

## Figures {#sec:figures}

Figures are created by adding `{#fig:label}` after an image. The syntax is:

```
![Caption text](image-url){#fig:label}
```

### Simple Figure

![A sample chart showing quarterly sales data](https://via.placeholder.com/600x400?text=Sales+Chart){#fig:sales}

The figure above (@fig:sales) shows a placeholder for a sales chart.

### Multiple Figures

Here are additional figures to demonstrate numbering:

![Distribution of customer segments](https://via.placeholder.com/500x300?text=Customer+Segments){#fig:segments}

![Revenue trends over time](https://via.placeholder.com/500x300?text=Revenue+Trends){#fig:trends}

![Comparison of product performance](https://via.placeholder.com/500x300?text=Product+Comparison){#fig:comparison}

As shown in @fig:segments, customer segments vary significantly. When combined with @fig:trends, we can see how revenue has changed. Finally, @fig:comparison provides a detailed product analysis.

## Tables {#sec:tables}

Tables are labeled by adding `{#tbl:label}` on a new line after the table.

### Basic Table

| Quarter | Revenue | Growth |
|---------|---------|--------|
| Q1 2024 | $1.2M   | 5%     |
| Q2 2024 | $1.4M   | 8%     |
| Q3 2024 | $1.5M   | 7%     |
| Q4 2024 | $1.8M   | 12%    |

{#tbl:quarterly}

@tbl:quarterly shows the quarterly revenue figures for 2024.

### Detailed Data Table

| Product | Category | Units Sold | Revenue | Margin |
|---------|----------|------------|---------|--------|
| Widget A | Hardware | 1,500 | $45,000 | 32% |
| Widget B | Hardware | 2,300 | $69,000 | 28% |
| Service X | Software | 800 | $120,000 | 65% |
| Service Y | Software | 1,200 | $180,000 | 70% |
| Bundle Z | Mixed | 450 | $90,000 | 45% |

{#tbl:products}

The product breakdown in @tbl:products reveals that software services have higher margins than hardware products.

### Summary Statistics

| Metric | Value |
|--------|-------|
| Total Revenue | $504,000 |
| Average Margin | 48% |
| Top Product | Service Y |

{#tbl:summary}

See @tbl:summary for the key metrics derived from @tbl:products.

## Combined Example {#sec:combined}

This section demonstrates using all three types of cross-references together in a cohesive narrative.

### Analysis Methodology {#sec:methodology}

As outlined in @sec:overview, our analysis uses multiple data sources. The methodology follows these steps:

1. Data collection (see @tbl:quarterly for raw data)
2. Visualization (see @fig:trends for trend analysis)
3. Comparison (see @fig:comparison for product comparison)

### Key Findings {#sec:findings}

Based on the data presented in @tbl:products and visualized in @fig:segments:

- Revenue increased consistently each quarter (@tbl:quarterly)
- Customer segments show distinct purchasing patterns (@fig:segments)
- Software services outperform hardware products (@tbl:products)

![Summary dashboard combining all metrics](https://via.placeholder.com/700x400?text=Summary+Dashboard){#fig:dashboard}

@fig:dashboard provides an integrated view of all the metrics discussed in @sec:methodology and @sec:findings.

### Recommendations {#sec:recommendations}

Based on our analysis in @sec:findings:

1. Focus on software services (highest margins per @tbl:products)
2. Target growing customer segments (see @fig:segments)
3. Maintain Q4 momentum (strongest growth per @tbl:quarterly)

## Formatting Examples {#sec:formatting}

This section includes various formatting to test DOCX export compatibility.

### Text Formatting

- **Bold text** for emphasis
- *Italic text* for titles or foreign words
- ~~Strikethrough~~ for deletions
- `inline code` for technical terms
- Combinations: ***bold and italic***, **bold with `code`**

### Lists

Ordered list:

1. First item
2. Second item
3. Third item

Unordered list:

- Item A
- Item B
- Item C

### Block Quote

> This is a block quote that might contain important information
> or a citation from another source. It can span multiple lines.

### Code Block

```python
def calculate_growth(current, previous):
    """Calculate percentage growth between two values."""
    if previous == 0:
        return 0
    return ((current - previous) / previous) * 100
```

## Conclusion {#sec:conclusion}

This document has demonstrated:

- Section references (@sec:intro through @sec:conclusion)
- Figure references (@fig:sales, @fig:segments, @fig:trends, @fig:comparison, @fig:dashboard)
- Table references (@tbl:quarterly, @tbl:products, @tbl:summary)

All cross-references should resolve to their correct numbers when exported to DOCX format. The label syntax (`{#type:label}`) should be removed from the output, and references (`@type:label`) should be replaced with "Figure N", "Section N", or "Table N" as appropriate.

---

## Reference Summary

### All Sections
- @sec:intro - Introduction
- @sec:overview - Overview
- @sec:sections - Section References
- @sec:subsection - Subsection Example
- @sec:figures - Figures
- @sec:tables - Tables
- @sec:combined - Combined Example
- @sec:methodology - Analysis Methodology
- @sec:findings - Key Findings
- @sec:recommendations - Recommendations
- @sec:formatting - Formatting Examples
- @sec:conclusion - Conclusion

### All Figures
- @fig:sales - Sales Chart
- @fig:segments - Customer Segments
- @fig:trends - Revenue Trends
- @fig:comparison - Product Comparison
- @fig:dashboard - Summary Dashboard

### All Tables
- @tbl:quarterly - Quarterly Revenue
- @tbl:products - Product Breakdown
- @tbl:summary - Summary Statistics
