"""Conflicts must be explained without knowing the team's identity."""
import unittest
from server.validation_diagnostics import diagnose


class DiagnosticTests(unittest.TestCase):
    def test_duplicate_metric(self):
        issues = diagnose('Compilation Error\n  dbt found two metrics with the name "equity_total_mtm".')
        self.assertEqual(issues[0]["code"], "duplicate-metric")
        self.assertEqual(issues[0]["field"], "equity_total_mtm")

    def test_cross_model_entity_dimension_conflict(self):
        log = (
            "In semantic models {'cdo_enterprise_positions'}, element `instrument_code` is of type "
            "SemanticModelElementType.DIMENSION, but it is used as types [DIMENSION, ENTITY] across the model.\n"
            "In semantic models {'team_equity_semantics'}, element `instrument_code` is of type "
            "SemanticModelElementType.ENTITY, but it is used as types [DIMENSION, ENTITY] across the model.\n"
            "Parsing Error\n Semantic Manifest validation failed."
        )
        issues = diagnose(log)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "semantic-element-conflict")
        self.assertEqual(issues[0]["field"], "instrument_code")
        self.assertEqual(issues[0]["models"], ["cdo_enterprise_positions", "team_equity_semantics"])

    def test_duplicate_entity_time_grain(self):
        log = ("Duplicate dimension + primary entity pairing detected, dimension + primary entity pairings must be unique. "
               "Semantic model `team_a_semantics` has a primary entity of `equity_position_id` and dimension "
               "`report_date`, but this pairing is already in use on semantic model `team_equity_semantics`.")
        issues = diagnose(log)
        self.assertEqual(issues[0]["code"], "duplicate-entity-dimension")
        self.assertEqual(issues[0]["field"], "report_date")

    def test_unrecognized_error_does_not_invent_diagnostic(self):
        self.assertEqual(diagnose("Database connection timed out"), [])


if __name__ == "__main__":
    unittest.main()
