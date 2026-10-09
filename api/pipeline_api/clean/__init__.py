"""RepScore data cleaning: the scripted part of turning verified SERP rows into the RepScore workbook.

Only mechanical rules live here (domain lists, the master media list, link and text dedupe, date checks). Anything
that needs judgement - passing mentions, wrong entities the brand rules cannot tell apart, tagging, sentiment - is
left for the later, reviewed phases.
"""
