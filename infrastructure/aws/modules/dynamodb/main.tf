resource "aws_dynamodb_table" "payment_tokens" {
  name           = "payment-tokens-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "paymentId"

  attribute {
    name = "paymentId"
    type = "S"
  }

  tags = {
    Name        = "payment-tokens-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "notifications" {
  name           = "notifications-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "notificationId"

  attribute {
    name = "notificationId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name     = "userId-index"
    hash_key = "userId"
  }

  tags = {
    Name        = "notifications-${var.environment}"
    Environment = var.environment
  }
}

