#ifndef CUSTOM_VECTOR_HPP
#define CUSTOM_VECTOR_HPP

#include <iostream>
#include <stdexcept>
#include <initializer_list>
#include <utility>

using namespace std;

template<typename T>
class CustomVector {
private:
    T* data;
    size_t current_size;
    size_t current_capacity;

public:
    // Constructors and Destructor
    CustomVector(size_t initial_capacity = 1) : current_size(0), current_capacity(initial_capacity) {
        data = (initial_capacity > 0) ? new T[initial_capacity] : nullptr;
    }

    CustomVector(initializer_list<T> list) : current_size(list.size()), current_capacity(list.size()) {
        data = new T[current_capacity];
        size_t i = 0;
        for (const auto& item : list) {
            data[i++] = item;
        }
    }

    CustomVector(const CustomVector& other) : current_size(other.current_size), current_capacity(other.current_capacity) {
        data = new T[current_capacity];
        for (size_t i = 0; i < current_size; i++) {
            data[i] = other.data[i];
        }
    }

    CustomVector& operator=(const CustomVector& other) {
        if (this != &other) {
            delete[] data;
            current_size = other.current_size;
            current_capacity = other.current_capacity;
            data = new T[current_capacity];
            for (size_t i = 0; i < current_size; i++) {
                data[i] = other.data[i];
            }
        }
        return *this;
    }

    CustomVector(CustomVector&& other) noexcept : data(other.data), current_size(other.current_size), current_capacity(other.current_capacity) {
        other.data = nullptr;
        other.current_size = 0;
        other.current_capacity = 0;
    }

    CustomVector& operator=(CustomVector&& other) noexcept {
        if (this != &other) {
            delete[] data;
            data = other.data;
            current_size = other.current_size;
            current_capacity = other.current_capacity;
            other.data = nullptr;
            other.current_size = 0;
            other.current_capacity = 0;
        }
        return *this;
    }

    ~CustomVector() {
        delete[] data;
    }

    // Capacity
    size_t size() const {
        return current_size;
    }

    size_t capacity() const {
        return current_capacity;
    }

    bool empty() const {
        return current_size == 0;
    }

    void reserve(size_t new_capacity) {
        if (new_capacity > current_capacity) {
            T* new_data = new T[new_capacity];
            for (size_t i = 0; i < current_size; i++) {
                new_data[i] = data[i];
            }
            delete[] data;
            data = new_data;
            current_capacity = new_capacity;
        }
    }

    void resize(size_t new_size, T value = T()) {
        if (new_size > current_capacity) {
            reserve(new_size);
        }
        for (size_t i = current_size; i < new_size; i++) {
            data[i] = value;
        }
        current_size = new_size;
    }

    void shrink_to_fit() {
        if (current_size < current_capacity) {
            T* new_data = new T[current_size];
            for (size_t i = 0; i < current_size; i++) {
                new_data[i] = data[i];
            }
            delete[] data;
            data = new_data;
            current_capacity = current_size;
        }
    }

    // Element Access
    T& at(size_t index) {
        if (index >= current_size) {
            throw out_of_range("Index out of range");
        }
        return data[index];
    }

    const T& at(size_t index) const {
        if (index >= current_size) {
            throw out_of_range("Index out of range");
        }
        return data[index];
    }

    T& operator[](size_t index) {
        return data[index];
    }

    const T& operator[](size_t index) const {
        return data[index];
    }

    T& front() {
        if (current_size == 0) {
            throw out_of_range("Vector is empty");
        }
        return data[0];
    }

    const T& front() const {
        if (current_size == 0) {
            throw out_of_range("Vector is empty");
        }
        return data[0];
    }

    T& back() {
        if (current_size == 0) {
            throw out_of_range("Vector is empty");
        }
        return data[current_size - 1];
    }

    const T& back() const {
        if (current_size == 0) {
            throw out_of_range("Vector is empty");
        }
        return data[current_size - 1];
    }

    // Modifiers
    void add_element(T value) {
        if (current_size == current_capacity) {
            reserve(current_capacity == 0 ? 1 : current_capacity * 2);
        }
        data[current_size++] = value;
    }

    void pop_element() {
        if (current_size > 0) {
            current_size--;
        }
    }

    void insert_element(size_t index, T value) {
        if (index > current_size) {
            throw out_of_range("Index out of range");
        }
        if (current_size == current_capacity) {
            reserve(current_capacity == 0 ? 1 : current_capacity * 2);
        }
        for (size_t i = current_size; i > index; i--) {
            data[i] = data[i - 1];
        }
        data[index] = value;
        current_size++;
    }

    void remove_element(size_t index) {
        if (index >= current_size) {
            throw out_of_range("Index out of range");
        }
        for (size_t i = index; i < current_size - 1; i++) {
            data[i] = data[i + 1];
        }
        current_size--;
    }

    void clear() {
        current_size = 0;
    }

    template<typename... Args>
    void emplace_back(Args&&... args) {
        if (current_size == current_capacity) {
            reserve(current_capacity == 0 ? 1 : current_capacity * 2);
        }
        data[current_size++] = T(forward<Args>(args)...);
    }

    // Iterators
    T* begin() {
        return data;
    }

    T* end() {
        return data + current_size;
    }

    const T* begin() const {
        return data;
    }

    const T* end() const {
        return data + current_size;
    }
};

#endif
