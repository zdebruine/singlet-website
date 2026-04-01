"""Sphinx configuration for singletai-website operational documentation."""

project = "singletai-website"
copyright = "2026, Singlet AI"
author = "Zach DeBruine"
release = "0.1.0"

extensions = [
    "myst_parser",
    "sphinx.ext.intersphinx",
    "sphinx_copybutton",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "furo"
html_title = "singletai-website"
html_theme_options = {
    "source_repository": "https://github.com/Singlet-AI/singletai-website",
    "source_branch": "main",
    "source_directory": "docs/",
}

myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "fieldlist",
    "tasklist",
]

intersphinx_mapping = {
    "singlet": ("https://singlet-ai.github.io/singlet/", None),
    "singlepress": ("https://singlet-ai.github.io/singlepress/", None),
    "geo-reprocess": ("https://singlet-ai.github.io/geo-reprocess/", None),
}
