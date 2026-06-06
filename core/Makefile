CC      = gcc
CFLAGS  = -std=c99 -Wall -Wextra -pedantic
TARGET  = simulator.exe
SRCS    = main.c cJSON.c

$(TARGET): $(SRCS)
	$(CC) $(CFLAGS) -o $(TARGET) $(SRCS)

clean:
	del /Q $(TARGET) 2>nul || true
