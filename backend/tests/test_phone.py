import unittest

from backend.phone import InvalidPhoneNumberError, normalize_phone_number


class NormalizePhoneNumberTest(unittest.TestCase):
    def test_local_singapore_number_defaults_to_sg_region(self) -> None:
        self.assertEqual(normalize_phone_number("9123 4567"), "+6591234567")

    def test_already_e164_number_is_unchanged(self) -> None:
        self.assertEqual(normalize_phone_number("+6591234567"), "+6591234567")

    def test_differently_formatted_inputs_normalize_to_the_same_value(self) -> None:
        variants = ["+65 9123 4567", "+6591234567", "9123-4567", " 9123 4567 "]
        normalized = {normalize_phone_number(variant) for variant in variants}
        self.assertEqual(normalized, {"+6591234567"})

    def test_other_country_code_is_respected_over_the_default_region(self) -> None:
        self.assertEqual(normalize_phone_number("+1 415 555 2671"), "+14155552671")

    def test_other_country_local_format_uses_explicit_default_region(self) -> None:
        self.assertEqual(
            normalize_phone_number("0415 555 121", default_region="AU"), "+61415555121"
        )

    def test_empty_string_is_invalid(self) -> None:
        with self.assertRaises(InvalidPhoneNumberError):
            normalize_phone_number("   ")

    def test_garbage_input_is_invalid(self) -> None:
        with self.assertRaises(InvalidPhoneNumberError):
            normalize_phone_number("not a phone number")

    def test_too_short_number_is_invalid(self) -> None:
        with self.assertRaises(InvalidPhoneNumberError):
            normalize_phone_number("123")


if __name__ == "__main__":
    unittest.main()
