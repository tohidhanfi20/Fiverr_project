# File Processor Lambda
data "archive_file" "file_processor" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../serverless/aws-lambda/file-processor"
  output_path = "${path.module}/file-processor.zip"
}

resource "aws_lambda_function" "file_processor" {
  filename         = data.archive_file.file_processor.output_path
  function_name    = "file-processor"
  role            = aws_iam_role.lambda.arn
  handler         = "index.handler"
  runtime         = "nodejs18.x"
  timeout         = 60

  environment {
    variables = {
      KAFKA_BROKERS        = var.kafka_brokers
      COURSE_SERVICE_URL   = var.course_service_url
      S3_BUCKET            = var.s3_bucket_id
    }
  }
}

resource "aws_lambda_permission" "s3_invoke" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.file_processor.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = "arn:aws:s3:::${var.s3_bucket_id}"
}

# Notification Processor Lambda
data "archive_file" "notification_processor" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../serverless/aws-lambda/notification-processor"
  output_path = "${path.module}/notification-processor.zip"
}

resource "aws_lambda_function" "notification_processor" {
  filename         = data.archive_file.notification_processor.output_path
  function_name    = "notification-processor"
  role            = aws_iam_role.lambda.arn
  handler         = "index.handler"
  runtime         = "nodejs18.x"
  timeout         = 60

  environment {
    variables = {
      AWS_REGION                      = "us-east-1"
      DYNAMODB_NOTIFICATIONS_TABLE    = "notifications-production"
      SES_FROM_EMAIL                  = "noreply@education-platform.com"
    }
  }
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = var.notification_queue_url
  function_name    = aws_lambda_function.notification_processor.arn
  batch_size       = 10
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda" {
  name = "education-platform-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_s3" {
  name = "lambda-s3-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject"
      ]
      Resource = "arn:aws:s3:::${var.s3_bucket_id}/*"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "lambda-dynamodb-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:GetItem"
      ]
      Resource = "arn:aws:dynamodb:*:*:table/*"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ses" {
  name = "lambda-ses-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ]
      Resource = "*"
    }]
  })
}

